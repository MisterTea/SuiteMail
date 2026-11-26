package com.suitemail.app;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure scheduled-send rules shared by the WorkManager job and the foreground plugin call.
 * Mirrors src/services/db/scheduledEmails.ts and calculateNextScheduledOccurrence in
 * src/services/snooze/scheduledSendManager.ts; keep them in step.
 */
final class ScheduledSendRules {
    private ScheduledSendRules() {}

    /** scheduled_at is Unix seconds; anything this large can only be milliseconds written by mistake. */
    static final long MILLISECOND_THRESHOLD = 100_000_000_000L;
    /** A 'sending' claim older than this belongs to a sender that was killed partway. */
    static final long STALE_SENDING_SECONDS = 10 * 60;
    private static final String DUE_AT = "(CASE WHEN scheduled_at > " + MILLISECOND_THRESHOLD + " THEN scheduled_at / 1000 ELSE scheduled_at END)";
    /** {@code now} is the SQL placeholder bound to the current Unix time. */
    static String dueSql(String now) { return DUE_AT + " <= " + now + " AND (created_at IS NULL OR created_at <= " + now + ")"; }

    static long normalize(long scheduledAt) {
        return scheduledAt > MILLISECOND_THRESHOLD ? scheduledAt / 1000 : scheduledAt;
    }

    /** Never early: the device clock must have reached scheduled_at and must not read earlier than when the email was scheduled. */
    static boolean isDue(long scheduledAt, Long createdAt, long nowSeconds) {
        if (createdAt != null && nowSeconds < createdAt) return false;
        return nowSeconds >= normalize(scheduledAt);
    }

    /** Same local-time arithmetic as JS Date#setDate / #setMonth (overflowing days roll forward). */
    static long nextOccurrence(long scheduledAt, String rule, TimeZone zone) {
        Calendar date = Calendar.getInstance(zone, Locale.US);
        date.setLenient(true);
        date.setTimeInMillis(normalize(scheduledAt) * 1000);
        switch (rule == null ? "" : rule.toLowerCase(Locale.ROOT)) {
            case "daily": date.set(Calendar.DAY_OF_MONTH, date.get(Calendar.DAY_OF_MONTH) + 1); break;
            case "weekdays":
                do { date.set(Calendar.DAY_OF_MONTH, date.get(Calendar.DAY_OF_MONTH) + 1); }
                while (date.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || date.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY);
                break;
            case "monthly": date.set(Calendar.MONTH, date.get(Calendar.MONTH) + 1); break;
            default: date.set(Calendar.DAY_OF_MONTH, date.get(Calendar.DAY_OF_MONTH) + 7); break;
        }
        return Math.floorDiv(date.getTimeInMillis(), 1000);
    }

    static boolean recurring(String rule) { return rule != null && !rule.isEmpty() && !"none".equals(rule); }

    private static final Pattern DATE = Pattern.compile("(?im)^Date:[^\\r\\n]*");
    private static final Pattern MESSAGE_ID = Pattern.compile("(?im)^Message-ID:[^\\r\\n]*?@([^>\\r\\n]+)>[^\\r\\n]*");

    /**
     * The MIME is built when the email is scheduled. Stamp it with the real send time and a fresh
     * Message-ID (recurring copies share one MIME). Only the header block is touched.
     */
    static String prepareForSend(String rawBase64Url, long nowMillis, String unique) {
        byte[] bytes = Base64.getUrlDecoder().decode(rawBase64Url.trim());
        String mime = new String(bytes, StandardCharsets.ISO_8859_1); // byte-for-byte round trip
        int end = mime.indexOf("\r\n\r\n");
        if (end < 0) end = mime.length();
        String headers = mime.substring(0, end);
        String date = DateTimeFormatter.RFC_1123_DATE_TIME.format(Instant.ofEpochMilli(nowMillis).atOffset(ZoneOffset.UTC));
        headers = DATE.matcher(headers).replaceFirst(Matcher.quoteReplacement("Date: " + date));
        Matcher id = MESSAGE_ID.matcher(headers);
        if (id.find()) {
            String domain = id.group(1);
            headers = headers.substring(0, id.start()) + "Message-ID: <" + nowMillis + "." + unique + "@" + domain + ">" + headers.substring(id.end());
        }
        byte[] out = (headers + mime.substring(end)).getBytes(StandardCharsets.ISO_8859_1);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
    }
}
