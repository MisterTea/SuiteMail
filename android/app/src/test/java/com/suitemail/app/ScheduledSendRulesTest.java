package com.suitemail.app;

import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Calendar;
import java.util.TimeZone;
import static org.junit.Assert.*;

public class ScheduledSendRulesTest {
    private static final long NOW = 1_800_000_000L;
    private static final TimeZone CHICAGO = TimeZone.getTimeZone("America/Chicago");

    @Test public void neverDueBeforeTheScheduledSecond() {
        assertFalse(ScheduledSendRules.isDue(NOW + 1, NOW - 60, NOW));
        assertTrue(ScheduledSendRules.isDue(NOW, NOW - 60, NOW));
    }

    @Test public void readsMillisecondTimestampsAsMilliseconds() {
        assertFalse(ScheduledSendRules.isDue((NOW + 60) * 1000, NOW - 60, NOW));
        assertTrue(ScheduledSendRules.isDue((NOW - 60) * 1000, NOW - 120, NOW));
    }

    @Test public void holdsWhileTheClockReadsEarlierThanWhenScheduled() {
        assertFalse(ScheduledSendRules.isDue(NOW - 600, NOW + 3600, NOW));
    }

    private static long local(int year, int month, int day, int hour) {
        Calendar c = Calendar.getInstance(CHICAGO); c.clear(); c.set(year, month, day, hour, 0, 0);
        return c.getTimeInMillis() / 1000;
    }

    @Test public void recurrenceMatchesTheJavaScriptRules() {
        assertEquals(local(2026, Calendar.NOVEMBER, 21, 9), ScheduledSendRules.nextOccurrence(local(2026, Calendar.NOVEMBER, 20, 9), "daily", CHICAGO));
        // Friday → Monday
        assertEquals(local(2026, Calendar.NOVEMBER, 23, 9), ScheduledSendRules.nextOccurrence(local(2026, Calendar.NOVEMBER, 20, 9), "weekdays", CHICAGO));
        assertEquals(local(2026, Calendar.NOVEMBER, 27, 9), ScheduledSendRules.nextOccurrence(local(2026, Calendar.NOVEMBER, 20, 9), "weekly", CHICAGO));
        assertEquals(local(2026, Calendar.NOVEMBER, 27, 9), ScheduledSendRules.nextOccurrence(local(2026, Calendar.NOVEMBER, 20, 9), "unknown", CHICAGO));
        // JS setMonth overflows Jan 31 into March, it doesn't clamp to Feb 28.
        assertEquals(local(2027, Calendar.MARCH, 3, 9), ScheduledSendRules.nextOccurrence(local(2027, Calendar.JANUARY, 31, 9), "monthly", CHICAGO));
        // Local wall-clock time survives the DST change (Nov 1, 2026 in Chicago).
        assertEquals(local(2026, Calendar.NOVEMBER, 1, 9), ScheduledSendRules.nextOccurrence(local(2026, Calendar.OCTOBER, 31, 9), "daily", CHICAGO));
    }

    @Test public void stampsTheSendTimeAndAFreshMessageIdWithoutTouchingTheBody() {
        String mime = "From: me@example.com\r\nDate: Mon, 01 Jan 2024 00:00:00 GMT\r\nMessage-ID: <1.abc@example.com>\r\nSubject: Hi\r\n\r\nDate: body line stays\r\n";
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(mime.getBytes(StandardCharsets.ISO_8859_1));
        String out = new String(Base64.getUrlDecoder().decode(ScheduledSendRules.prepareForSend(raw, NOW * 1000, "xyz")), StandardCharsets.ISO_8859_1);
        assertTrue(out, out.contains("\r\nDate: Fri, 15 Jan 2027 08:00:00 GMT\r\n"));
        assertTrue(out, out.contains("\r\nMessage-ID: <" + NOW * 1000 + ".xyz@example.com>\r\n"));
        assertTrue(out.endsWith("\r\n\r\nDate: body line stays\r\n"));
        assertFalse(out.contains("01 Jan 2024"));
    }
}
