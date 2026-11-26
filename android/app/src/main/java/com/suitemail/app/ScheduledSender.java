package com.suitemail.app;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * The only code that sends scheduled mail on Android. It runs from ScheduledSendWorker (WorkManager,
 * app closed) and from BackgroundMailPlugin.runDueScheduledSends (app open), through the app's own
 * database connection (AppDatabase). Rules:
 *  - never early: rows are only claimed when ScheduledSendRules.dueSql holds for the device clock;
 *  - exactly once: a row is claimed with one conditional UPDATE (pending → sending) in its own committed
 *    transaction, so neither another sender nor someone else's rollback can hand it out twice, and this
 *    class also serializes its own runs;
 *  - a claim left in 'sending' by a killed run is marked failed, never retried, because Gmail may
 *    already have accepted it.
 */
final class ScheduledSender {
    private ScheduledSender() {}
    static final class Result { int sent, failed, deferred; }
    private static final Object LOCK = new Object();
    private static final String SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    static final String DEBUG_SEND_URL = "debug_scheduled_send_url";
    static final String DEBUG_ACCESS_TOKEN = "debug_scheduled_access_token";

    private static class NotSent extends Exception { NotSent(String m, Throwable c){super(m,c);} }
    private static class Rejected extends Exception { Rejected(String m){super(m);} }
    private static class Unauthorized extends Exception {}

    private static JSONArray select(Context context, String query, Object... params) throws Exception { return AppDatabase.select(context, query, params); }
    private static JSONArray transaction(Context context, Object[]... statements) throws Exception { return AppDatabase.transaction(context, statements); }

    static Result run(Context context) {
        synchronized (LOCK) {
            Result result = new Result();
            try {
                if (select(context, "SELECT name FROM pragma_table_info('scheduled_emails') WHERE name IN ('raw_mime','claimed_at')").length() != 2)
                    return result; // The app hasn't migrated this database yet.
                long now = System.currentTimeMillis() / 1000;
                transaction(context, new Object[]{"UPDATE scheduled_emails SET status = 'failed' WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < $1)",
                    now - ScheduledSendRules.STALE_SENDING_SECONDS});
                JSONArray due = select(context, "SELECT id FROM scheduled_emails WHERE status = 'pending' AND raw_mime IS NOT NULL AND "
                    + ScheduledSendRules.dueSql("$1") + " ORDER BY scheduled_at ASC", now);
                Map<String, String> tokens = new HashMap<>();
                for (int i = 0; i < due.length(); i++) sendOne(context, due.getJSONObject(i).getString("id"), tokens, result);
            } catch (Exception e) {
                android.util.Log.w("SuiteMail", "Scheduled send run stopped", e);
            }
            return result;
        }
    }

    /** If this can't be recorded the row stays 'sending' and is later marked failed: never sent twice. */
    private static void setStatus(Context context, String id, String status) {
        try { transaction(context, new Object[]{"UPDATE scheduled_emails SET status = $1 WHERE id = $2 AND status = 'sending'", status, id}); }
        catch (Exception e) { android.util.Log.w("SuiteMail", "Could not record scheduled email " + id + " as " + status, e); }
    }

    private static void sendOne(Context context, String id, Map<String, String> tokens, Result result) {
        long now = System.currentTimeMillis() / 1000;
        try {
            JSONArray claimed = transaction(context, new Object[]{"UPDATE scheduled_emails SET status = 'sending', claimed_at = $2 WHERE id = $1 AND status = 'pending' AND "
                + ScheduledSendRules.dueSql("$2"), id, now});
            if (claimed.getInt(0) != 1) return; // Not due any more, cancelled, or claimed by someone else.
        } catch (Exception e) { return; } // Database busy: try again on the next run.
        try {
            JSONArray rows = select(context, "SELECT s.raw_mime, s.thread_id, s.recurrence_rule, s.scheduled_at, s.created_at, a.email, a.provider "
                + "FROM scheduled_emails s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.id = $1", id);
            if (rows.length() == 0) throw new Rejected("Scheduled email disappeared");
            JSONObject row = rows.getJSONObject(0);
            String raw = row.optString("raw_mime", null), accountEmail = row.isNull("email") ? null : row.getString("email");
            String threadId = row.isNull("thread_id") ? null : row.getString("thread_id");
            String rule = row.isNull("recurrence_rule") ? null : row.getString("recurrence_rule");
            long scheduledAt = row.getLong("scheduled_at");
            Long createdAt = row.isNull("created_at") ? null : row.getLong("created_at");
            // Match the JS sender: a missing account, or one that isn't Gmail, can't send scheduled mail.
            if (raw == null || accountEmail == null || !"gmail_api".equals(row.optString("provider"))) throw new Rejected("Not a Gmail account");
            String body = new JSONObject().put("raw", ScheduledSendRules.prepareForSend(raw, System.currentTimeMillis(), UUID.randomUUID().toString().replace("-", "")))
                .put("threadId", threadId == null ? JSONObject.NULL : threadId).toString();
            boolean retried = false;
            while (true) {
                String token = tokens.containsKey(accountEmail) ? tokens.get(accountEmail) : token(context, accountEmail, null);
                tokens.put(accountEmail, token);
                // Re-check right before the request with a fresh clock reading.
                if (!ScheduledSendRules.isDue(scheduledAt, createdAt, System.currentTimeMillis() / 1000)) throw new NotSent("not due", null);
                try { post(context, token, body); break; }
                catch (Unauthorized e) {
                    if (retried) throw new NotSent("Gmail rejected the saved authorization", null); // A 401 means nothing was sent.
                    retried = true; tokens.remove(accountEmail); token(context, accountEmail, token);
                }
            }
            Object[] sent = {"UPDATE scheduled_emails SET status = 'sent' WHERE id = $1 AND status = 'sending'", id};
            Object[][] statements = ScheduledSendRules.recurring(rule) ? new Object[][]{sent, {
                "INSERT INTO scheduled_emails (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, reply_to_message_id, thread_id, "
                + "scheduled_at, signature_id, attachment_paths, recurrence_rule, from_address, raw_mime) SELECT $1, account_id, to_addresses, cc_addresses, "
                + "bcc_addresses, subject, body_html, reply_to_message_id, thread_id, $2, signature_id, attachment_paths, recurrence_rule, from_address, raw_mime "
                + "FROM scheduled_emails WHERE id = $3", UUID.randomUUID().toString(), ScheduledSendRules.nextOccurrence(scheduledAt, rule, TimeZone.getDefault()), id}}
                : new Object[][]{sent};
            // Gmail has the email now. Record it; if the database stays busy the row stays 'sending' and is later marked failed, not resent.
            for (int attempt = 0; ; attempt++) {
                try { transaction(context, statements); break; }
                catch (Exception e) {
                    if (attempt >= 19) { android.util.Log.w("SuiteMail", "Could not record scheduled send " + id, e); break; }
                    Thread.sleep(250);
                }
            }
            result.sent++;
        } catch (NotSent e) {
            setStatus(context, id, "pending"); result.deferred++; // Gmail never saw it: safe to try again later.
        } catch (Exception e) {
            android.util.Log.w("SuiteMail", "Scheduled email " + id + " failed", e);
            setStatus(context, id, "failed"); result.failed++;
        }
    }

    private static boolean debuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Google Play services renews the token; never shows UI from here. Failure means nothing was sent. */
    private static String token(Context context, String email, String invalid) throws NotSent {
        SharedPreferences prefs = BackgroundMailScheduler.prefs(context);
        if (debuggable(context) && prefs.contains(DEBUG_ACCESS_TOKEN)) return prefs.getString(DEBUG_ACCESS_TOKEN, "");
        try {
            if (invalid != null) Tasks.await(Identity.getAuthorizationClient(context).clearToken(ClearTokenRequest.builder().setToken(invalid).build()), 20, TimeUnit.SECONDS);
            AuthorizationRequest request = AuthorizationRequest.builder().setAccount(new Account(email, "com.google"))
                .setRequestedScopes(GoogleAccountsPlugin.SCOPES.stream().map(Scope::new).collect(Collectors.toList())).build();
            AuthorizationResult auth = Tasks.await(Identity.getAuthorizationClient(context).authorize(request), 30, TimeUnit.SECONDS);
            if (auth.hasResolution() || auth.getAccessToken() == null) throw new NotSent("Gmail needs to be reconnected", null);
            return auth.getAccessToken();
        } catch (NotSent e) { throw e; }
        catch (Exception e) { throw new NotSent("Could not renew Gmail access", e); }
    }

    private static void post(Context context, String token, String body) throws Exception {
        SharedPreferences prefs = BackgroundMailScheduler.prefs(context);
        String url = debuggable(context) ? prefs.getString(DEBUG_SEND_URL, SEND_URL) : SEND_URL;
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000); connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try {
            try { connection.connect(); }
            catch (IOException e) { throw new NotSent("Could not reach Gmail", e); } // Nothing left the device.
            // From here on Gmail may have received the email, so an unreadable reply is a failure, not a retry.
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) return;
            if (status == 401) throw new Unauthorized();
            // 429 and 503 mean Gmail did not process the request; any other error may have been half-processed.
            if (status == 429 || status == 503) throw new NotSent("Gmail asked to retry later (" + status + ")", null);
            throw new Rejected("Gmail returned " + status);
        } finally { connection.disconnect(); }
    }
}
