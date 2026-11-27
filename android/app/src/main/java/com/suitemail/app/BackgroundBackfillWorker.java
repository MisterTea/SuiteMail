package com.suitemail.app;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.annotation.NonNull;
import androidx.work.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Runs Gmail historical metadata backfill in the background via WorkManager so accounts finish
 * their initial sync window (default 365 days) even after the user leaves the app.
 *
 * Shares the exact same SQLite schema and `gmail_initial_sync:<accountId>` checkpoint format as
 * foreground `initialSync()` in src/services/gmail/sync.ts.
 */
public class BackgroundBackfillWorker extends Worker {
    static final int LIST_PAGE_SIZE = 500;
    static final int CHUNK_SIZE = 25;
    static final int DEFAULT_SYNC_DAYS = 365;
    /** Stay safely under WorkManager's 10-minute per-run execution window. */
    static final long RUN_BUDGET_MS = 8 * 60_000L;
    private static final String GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
    private static final String GMAIL_BATCH_URL = "https://www.googleapis.com/batch/gmail/v1";
    private static final Pattern BOUNDARY_PATTERN = Pattern.compile("boundary=(?:\"([^\"]+)\"|([^;\\s]+))", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_ID_PATTERN = Pattern.compile("Content-ID:\\s*<?([^>\\r\\n]+)>?", Pattern.CASE_INSENSITIVE);
    private static final Pattern HTTP_STATUS_PATTERN = Pattern.compile("^HTTP/[\\d.]+\\s+(\\d{3})");

    private final Context context;
    private final SharedPreferences prefs;
    private long nextRequest = 0;
    private String currentAccount = "";
    private String token = "";
    private String email = "";

    private static class Paused extends Exception {}
    private static class Reconnect extends Exception {}
    private static class RateLimited extends Exception {}
    private static class HttpError extends IOException {
        final int status;
        HttpError(int status) { super("Google HTTP " + status); this.status = status; }
    }

    static final class BatchPart {
        final int status;
        final String body;
        BatchPart(int status, String body) { this.status = status; this.body = body; }
    }

    public BackgroundBackfillWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
        this.context = context;
        this.prefs = BackgroundMailScheduler.prefs(context);
    }

    private void check() throws Paused {
        if (isStopped() || BackgroundMailScheduler.foreground || !BackgroundMailScheduler.enabled(context)) {
            throw new Paused();
        }
    }

    private boolean debuggable() {
        return (context.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private void authorize() throws Exception {
        if (debuggable() && prefs.contains(BackgroundMailWorker.DEBUG_ACCESS_TOKEN)) {
            token = prefs.getString(BackgroundMailWorker.DEBUG_ACCESS_TOKEN, "");
            return;
        }
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setAccount(new Account(email, "com.google"))
            .setRequestedScopes(GoogleAccountsPlugin.SCOPES.stream().map(Scope::new).collect(Collectors.toList()))
            .build();
        AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(context).authorize(request), 30, TimeUnit.SECONDS);
        if (result.hasResolution() || result.getAccessToken() == null
                || !result.getGrantedScopes().contains(GoogleAccountsPlugin.SCOPES.get(0))) {
            throw new Reconnect();
        }
        token = result.getAccessToken();
    }

    private void pace(int cost) throws Exception {
        check();
        long until = Math.max(nextRequest, prefs.getLong("cooldown:" + currentAccount, 0));
        if (until - System.currentTimeMillis() > 15_000) throw new RateLimited();
        while (System.currentTimeMillis() < until) {
            check();
            Thread.sleep(Math.max(1, Math.min(250, until - System.currentTimeMillis())));
        }
        // 4,500 units/minute (75 units/sec), matching foreground & BackgroundMailWorker quota budget.
        nextRequest = System.currentTimeMillis() + cost * 40L / 3;
    }

    private static boolean isRateLimit(int status, String body) {
        return status == 429 || (status == 403 && (body.contains("rateLimitExceeded")
            || body.contains("userRateLimitExceeded") || body.contains("RATE_LIMIT_EXCEEDED")));
    }

    private void recordCooldown(HttpURLConnection connection) {
        long delay = 60_000;
        String retry = connection.getHeaderField("Retry-After");
        try {
            if (retry != null) delay = Math.max(delay, Long.parseLong(retry.trim()) * 1000L);
        } catch (NumberFormatException ignored) {}
        prefs.edit().putLong("cooldown:" + currentAccount, System.currentTimeMillis() + delay).commit();
    }

    private static String readBody(HttpURLConnection connection, int status) throws IOException {
        InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
        if (stream == null) return "";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream input = stream) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
        }
        return bytes.toString("UTF-8");
    }

    private JSONObject getJson(String resource, int cost, boolean retried) throws Exception {
        pace(cost);
        String base = debuggable() ? prefs.getString(BackgroundMailWorker.DEBUG_GMAIL_URL, GMAIL_URL) : GMAIL_URL;
        HttpURLConnection connection = (HttpURLConnection) new URL(base + resource).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(25_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setInstanceFollowRedirects(false);
        int status;
        String body;
        try {
            status = connection.getResponseCode();
            body = readBody(connection, status);
            if (isRateLimit(status, body)) {
                recordCooldown(connection);
                throw new RateLimited();
            }
        } finally {
            connection.disconnect();
        }
        if (status == 401 && !retried) {
            Tasks.await(Identity.getAuthorizationClient(context)
                .clearToken(ClearTokenRequest.builder().setToken(token).build()), 20, TimeUnit.SECONDS);
            authorize();
            return getJson(resource, cost, true);
        }
        if (status < 200 || status >= 300) throw new HttpError(status);
        return new JSONObject(body);
    }

    private Map<String, JSONObject> fetchMetadataBatch(List<String> threadIds, boolean retried) throws Exception {
        String base = debuggable() ? prefs.getString(BackgroundMailWorker.DEBUG_GMAIL_URL, GMAIL_URL) : GMAIL_URL;
        if (!GMAIL_URL.equals(base)) {
            // Debug local server fallback: individual metadata GETs.
            Map<String, JSONObject> out = new LinkedHashMap<>();
            for (String id : threadIds) {
                try {
                    out.put(id, getJson("/threads/" + URLEncoder.encode(id, "UTF-8") + "?format=metadata", 10, false));
                } catch (HttpError e) {
                    if (e.status != 404) throw e;
                }
            }
            return out;
        }

        pace(threadIds.size() * 10);
        String boundary = "suitemail_backfill_" + UUID.randomUUID().toString().replace("-", "");
        byte[] payload = buildBatchBody(boundary, threadIds).getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(GMAIL_BATCH_URL).openConnection();
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(45_000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "multipart/mixed; boundary=" + boundary);
        connection.setInstanceFollowRedirects(false);
        int status;
        String contentType;
        String body;
        try {
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            status = connection.getResponseCode();
            contentType = connection.getContentType() != null ? connection.getContentType() : "";
            body = readBody(connection, status);
            if (isRateLimit(status, body)) {
                recordCooldown(connection);
                throw new RateLimited();
            }
        } finally {
            connection.disconnect();
        }
        if (status == 401 && !retried) {
            Tasks.await(Identity.getAuthorizationClient(context)
                .clearToken(ClearTokenRequest.builder().setToken(token).build()), 20, TimeUnit.SECONDS);
            authorize();
            return fetchMetadataBatch(threadIds, true);
        }
        if (status < 200 || status >= 300) throw new HttpError(status);

        Map<String, BatchPart> parts = parseBatchResponse(contentType, body);
        Map<String, JSONObject> threads = new LinkedHashMap<>();
        boolean sawUnauthorized = false;
        for (int i = 0; i < threadIds.size(); i++) {
            String id = threadIds.get(i);
            BatchPart part = parts.get(String.valueOf(i));
            if (part == null) throw new HttpError(502);
            if (part.status == 404) continue;
            if (part.status == 401) { sawUnauthorized = true; continue; }
            if (isRateLimit(part.status, part.body)) {
                prefs.edit().putLong("cooldown:" + currentAccount, System.currentTimeMillis() + 60_000L).commit();
                throw new RateLimited();
            }
            if (part.status < 200 || part.status >= 300) throw new HttpError(part.status);
            if (!part.body.isEmpty()) threads.put(id, new JSONObject(part.body));
        }
        if (sawUnauthorized && !retried) {
            Tasks.await(Identity.getAuthorizationClient(context)
                .clearToken(ClearTokenRequest.builder().setToken(token).build()), 20, TimeUnit.SECONDS);
            authorize();
            return fetchMetadataBatch(threadIds, true);
        }
        if (sawUnauthorized) throw new HttpError(401);
        return threads;
    }

    static String buildBatchBody(String boundary, List<String> threadIds) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < threadIds.size(); i++) {
            String encoded;
            try { encoded = URLEncoder.encode(threadIds.get(i), "UTF-8"); }
            catch (UnsupportedEncodingException e) { encoded = threadIds.get(i); }
            sb.append("--").append(boundary).append("\r\n")
              .append("Content-Type: application/http\r\n")
              .append("Content-ID: <").append(i).append(">\r\n\r\n")
              .append("GET /gmail/v1/users/me/threads/").append(encoded).append("?format=metadata\r\n\r\n");
        }
        sb.append("--").append(boundary).append("--\r\n");
        return sb.toString();
    }

    static Map<String, BatchPart> parseBatchResponse(String contentType, String text) {
        String boundary = null;
        if (contentType != null) {
            Matcher m = BOUNDARY_PATTERN.matcher(contentType);
            if (m.find()) boundary = m.group(1) != null ? m.group(1) : m.group(2);
        }
        if (boundary == null) {
            int start = text.indexOf("--");
            if (start >= 0) {
                int end = text.indexOf('\n', start);
                if (end > start + 2) boundary = text.substring(start + 2, end).trim();
            }
        }
        if (boundary == null || boundary.isEmpty()) throw new IllegalArgumentException("Missing multipart boundary");
        Map<String, BatchPart> result = new LinkedHashMap<>();
        String delimiter = "--" + boundary;
        String[] rawParts = text.split(Pattern.quote(delimiter));
        for (String raw : rawParts) {
            String part = raw.replaceFirst("^\\r?\\n", "");
            if (part.trim().isEmpty() || part.startsWith("--")) continue;
            int headerEnd = indexOfDoubleNewline(part);
            if (headerEnd < 0) continue;
            String outerHeaders = part.substring(0, headerEnd);
            Matcher idMatcher = CONTENT_ID_PATTERN.matcher(outerHeaders);
            if (!idMatcher.find()) continue;
            String id = idMatcher.group(1).trim().replaceFirst("^response-", "");
            String http = skipDoubleNewline(part, headerEnd);
            Matcher statusMatcher = HTTP_STATUS_PATTERN.matcher(http);
            if (!statusMatcher.find()) continue;
            int status = Integer.parseInt(statusMatcher.group(1));
            int bodyStart = indexOfDoubleNewline(http);
            String body = bodyStart < 0 ? "" : skipDoubleNewline(http, bodyStart).trim();
            result.put(id, new BatchPart(status, body));
        }
        return result;
    }

    private static int indexOfDoubleNewline(String s) {
        int crlf = s.indexOf("\r\n\r\n");
        int lf = s.indexOf("\n\n");
        if (crlf >= 0 && lf >= 0) return Math.min(crlf, lf);
        return Math.max(crlf, lf);
    }

    private static String skipDoubleNewline(String s, int index) {
        if (s.startsWith("\r\n\r\n", index)) return s.substring(index + 4);
        if (s.startsWith("\n\n", index)) return s.substring(index + 2);
        return s.substring(index);
    }

    static String buildQuery(int daysBack, Calendar now) {
        Calendar cal = (Calendar) now.clone();
        cal.add(Calendar.DAY_OF_YEAR, -daysBack);
        return "after:" + cal.get(Calendar.YEAR) + "/" + (cal.get(Calendar.MONTH) + 1) + "/" + cal.get(Calendar.DAY_OF_MONTH);
    }

    static JSONObject parseCheckpoint(String raw, int daysBack) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject saved = new JSONObject(raw);
            if (saved.optInt("version", 0) != 1) return null;
            if (saved.optInt("daysBack", -1) != daysBack) return null;
            String historyId = saved.optString("historyId", "");
            String query = saved.optString("query", "");
            if (historyId.isEmpty() || query.isEmpty()) return null;
            if (!saved.has("completed") || saved.optJSONArray("storedIds") == null) return null;
            return saved;
        } catch (JSONException e) {
            return null;
        }
    }

    private static String headerValue(JSONObject message, String name) {
        JSONObject payload = message.optJSONObject("payload");
        if (payload == null) return null;
        JSONArray headers = payload.optJSONArray("headers");
        if (headers == null) return null;
        for (int i = 0; i < headers.length(); i++) {
            JSONObject h = headers.optJSONObject(i);
            if (h != null && name.equalsIgnoreCase(h.optString("name", ""))) {
                return h.isNull("value") ? null : h.optString("value", null);
            }
        }
        return null;
    }

    /** Matches parseEmailAddress in src/services/gmail/messageParser.ts. */
    static String[] parseEmailAddress(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new String[]{null, null};
        String trimmed = raw.trim();
        int lt = trimmed.lastIndexOf('<');
        int gt = trimmed.lastIndexOf('>');
        if (lt >= 0 && gt > lt) {
            String address = trimmed.substring(lt + 1, gt).trim();
            String name = trimmed.substring(0, lt).trim();
            if (name.startsWith("\"") && name.endsWith("\"") && name.length() >= 2) {
                name = name.substring(1, name.length() - 1).trim();
            }
            if (address.isEmpty()) address = null;
            if (name.isEmpty() || (address != null && name.equals(address))) name = null;
            return new String[]{name, address};
        }
        return new String[]{null, trimmed};
    }

    /**
     * Build SQLite statements to store a format=metadata Gmail thread, matching processAndStoreThread()
     * in src/services/gmail/sync.ts. Never overwrites existing cached bodies.
     */
    static List<Object[]> buildThreadStorageStatements(String accountId, JSONObject thread) throws JSONException {
        List<Object[]> statements = new ArrayList<>();
        JSONArray messages = thread.optJSONArray("messages");
        if (messages == null || messages.length() == 0) return statements;
        String threadId = thread.getString("id");

        Set<String> allLabels = new LinkedHashSet<>();
        boolean allRead = true;
        boolean anyStarred = false;
        boolean anyAttachments = false;
        String firstSubject = null;
        String lastSnippet = "";
        long lastDate = 0L;
        List<String> messageIds = new ArrayList<>(messages.length());

        List<Object[]> messageUpserts = new ArrayList<>(messages.length());
        for (int i = 0; i < messages.length(); i++) {
            JSONObject msg = messages.getJSONObject(i);
            String msgId = msg.getString("id");
            messageIds.add(msgId);
            JSONArray labels = msg.optJSONArray("labelIds");
            Set<String> msgLabels = new HashSet<>();
            if (labels != null) {
                for (int j = 0; j < labels.length(); j++) {
                    String lid = labels.optString(j, "");
                    if (!lid.isEmpty()) {
                        msgLabels.add(lid);
                        allLabels.add(lid);
                    }
                }
            }
            boolean isRead = !msgLabels.contains("UNREAD");
            boolean isStarred = msgLabels.contains("STARRED");
            if (!isRead) allRead = false;
            if (isStarred) anyStarred = true;

            JSONObject payload = msg.optJSONObject("payload");
            boolean hasAtt = payload != null && "multipart/mixed".equals(payload.optString("mimeType", ""));
            if (hasAtt) anyAttachments = true;

            String[] from = parseEmailAddress(headerValue(msg, "From"));
            String subject = headerValue(msg, "Subject");
            String snippet = msg.optString("snippet", "");
            long internalDate = 0L;
            try { internalDate = Long.parseLong(msg.optString("internalDate", "0")); } catch (NumberFormatException ignored) {}
            int rawSize = msg.optInt("sizeEstimate", 0);

            if (i == 0) firstSubject = subject;
            if (i == messages.length() - 1) {
                lastSnippet = snippet;
                lastDate = internalDate;
            }

            messageUpserts.add(new Object[]{
                "INSERT INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, subject, snippet, date, is_read, is_starred, body_html, body_text, body_cached, raw_size, internal_date, list_unsubscribe, list_unsubscribe_post, auth_results, message_id_header, references_header, in_reply_to_header, imap_uid, imap_folder) "
                    + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,0,$15,$16,$17,$18,NULL,NULL,NULL,NULL,NULL,NULL) "
                    + "ON CONFLICT(account_id, id) DO UPDATE SET "
                    + "from_address=$4, from_name=$5, to_addresses=$6, cc_addresses=$7, bcc_addresses=$8, reply_to=$9, "
                    + "subject=$10, snippet=$11, date=$12, is_read=$13, is_starred=$14, raw_size=$15, internal_date=$16, "
                    + "list_unsubscribe=$17, list_unsubscribe_post=$18",
                msgId,
                accountId,
                threadId,
                from[1],
                from[0],
                headerValue(msg, "To"),
                headerValue(msg, "Cc"),
                headerValue(msg, "Bcc"),
                headerValue(msg, "Reply-To"),
                subject,
                snippet,
                internalDate,
                isRead ? 1 : 0,
                isStarred ? 1 : 0,
                rawSize,
                internalDate,
                headerValue(msg, "List-Unsubscribe"),
                headerValue(msg, "List-Unsubscribe-Post"),
            });
        }

        statements.add(new Object[]{
            "INSERT INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_starred, is_important, has_attachments, is_filtered) "
                + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, 0)) "
                + "ON CONFLICT(account_id, id) DO UPDATE SET "
                + "subject=$3, snippet=$4, last_message_at=$5, message_count=$6, is_read=$7, is_starred=$8, is_important=$9, has_attachments=$10, "
                + "is_filtered=COALESCE($11, threads.is_filtered)",
            threadId,
            accountId,
            firstSubject,
            lastSnippet,
            lastDate,
            messages.length(),
            allRead ? 1 : 0,
            anyStarred ? 1 : 0,
            allLabels.contains("IMPORTANT") ? 1 : 0,
            anyAttachments ? 1 : 0,
            null,
        });

        statements.add(new Object[]{
            "DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2",
            accountId,
            threadId,
        });
        for (String lid : allLabels) {
            statements.add(new Object[]{
                "INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
                accountId,
                threadId,
                lid,
            });
        }

        statements.addAll(messageUpserts);

        StringBuilder placeholders = new StringBuilder();
        Object[] deleteParams = new Object[messageIds.size() + 3];
        for (int i = 0; i < messageIds.size(); i++) {
            if (i > 0) placeholders.append(",");
            placeholders.append("$").append(i + 3);
            deleteParams[i + 3] = messageIds.get(i);
        }
        deleteParams[0] = "DELETE FROM messages WHERE account_id = $1 AND thread_id = $2 AND id NOT IN (" + placeholders + ")";
        deleteParams[1] = accountId;
        deleteParams[2] = threadId;
        statements.add(deleteParams);

        return statements;
    }

    private int readSyncPeriodDays() {
        try {
            JSONArray rows = AppDatabase.select(context, "SELECT value FROM settings WHERE key = $1", "sync_period_days");
            if (rows.length() > 0) {
                int parsed = Integer.parseInt(AppDatabase.string(rows.getJSONObject(0), "value"));
                if (parsed > 0) return parsed;
            }
        } catch (Exception ignored) {}
        return DEFAULT_SYNC_DAYS;
    }

    private boolean accountStillNeedsBackfill(String accountId) throws Exception {
        JSONArray rows = AppDatabase.select(context,
            "SELECT history_id FROM accounts WHERE id = $1 AND is_active = 1 AND provider = 'gmail_api'", accountId);
        if (rows.length() == 0) return false;
        String historyId = AppDatabase.string(rows.getJSONObject(0), "history_id");
        return historyId == null || historyId.isEmpty();
    }

    private Set<String> pendingResourceIds(String accountId, List<String> threadIds) throws Exception {
        Set<String> pending = new HashSet<>();
        if (threadIds.isEmpty()) return pending;
        StringBuilder placeholders = new StringBuilder();
        Object[] params = new Object[threadIds.size() + 1];
        params[0] = accountId;
        for (int i = 0; i < threadIds.size(); i++) {
            if (i > 0) placeholders.append(",");
            placeholders.append("$").append(i + 2);
            params[i + 1] = threadIds.get(i);
        }
        JSONArray rows = AppDatabase.select(context,
            "SELECT DISTINCT resource_id FROM pending_operations WHERE account_id = $1 AND status = 'pending' AND resource_id IN (" + placeholders + ")",
            params);
        for (int i = 0; i < rows.length(); i++) {
            String rid = AppDatabase.string(rows.getJSONObject(i), "resource_id");
            if (rid != null) pending.add(rid);
        }
        return pending;
    }

    private void saveCheckpoint(String key, JSONObject checkpoint) throws Exception {
        AppDatabase.transaction(context, new Object[]{
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
            key,
            checkpoint.toString(),
        });
    }

    /** Returns true when this account's backfill is complete, false if it stopped early at deadline. */
    private boolean backfillAccount(String accountId, String accountEmail, int daysBack, long deadline) throws Exception {
        currentAccount = accountId;
        email = accountEmail;
        authorize();

        String key = "gmail_initial_sync:" + accountId;
        JSONArray savedRows = AppDatabase.select(context, "SELECT value FROM settings WHERE key = $1", key);
        JSONObject checkpoint = savedRows.length() > 0
            ? parseCheckpoint(AppDatabase.string(savedRows.getJSONObject(0), "value"), daysBack)
            : null;
        if (checkpoint == null) {
            JSONObject profile = getJson("/profile?fields=historyId", 1, false);
            checkpoint = new JSONObject()
                .put("version", 1)
                .put("daysBack", daysBack)
                .put("query", buildQuery(daysBack, Calendar.getInstance()))
                .put("historyId", profile.getString("historyId"))
                .put("completed", 0)
                .put("total", 0)
                .put("storedIds", new JSONArray());
            check();
            if (!accountStillNeedsBackfill(accountId)) return true;
            saveCheckpoint(key, checkpoint);
        }

        while (true) {
            check();
            if (System.currentTimeMillis() >= deadline) return false;

            StringBuilder listPath = new StringBuilder("/threads?maxResults=").append(LIST_PAGE_SIZE)
                .append("&q=").append(URLEncoder.encode(checkpoint.getString("query"), "UTF-8"));
            String pageToken = checkpoint.optString("pageToken", "");
            if (!pageToken.isEmpty()) {
                listPath.append("&pageToken=").append(URLEncoder.encode(pageToken, "UTF-8"));
            }

            JSONObject listResponse = getJson(listPath.toString(), 5, false);
            JSONArray stubs = listResponse.optJSONArray("threads");
            int stubCount = stubs == null ? 0 : stubs.length();
            int completed = checkpoint.optInt("completed", 0);
            int estimate = listResponse.optInt("resultSizeEstimate", 0);
            checkpoint.put("total", Math.max(checkpoint.optInt("total", 0), Math.max(completed + stubCount, estimate)));

            JSONArray storedIdsJson = checkpoint.getJSONArray("storedIds");
            Set<String> storedSet = new HashSet<>(storedIdsJson.length());
            for (int i = 0; i < storedIdsJson.length(); i++) storedSet.add(storedIdsJson.optString(i, ""));

            List<String> remaining = new ArrayList<>();
            for (int i = 0; i < stubCount; i++) {
                String id = stubs.getJSONObject(i).optString("id", "");
                if (!id.isEmpty() && !storedSet.contains(id)) remaining.add(id);
            }

            for (int start = 0; start < remaining.size(); start += CHUNK_SIZE) {
                check();
                if (System.currentTimeMillis() >= deadline) return false;
                List<String> chunk = remaining.subList(start, Math.min(start + CHUNK_SIZE, remaining.size()));
                Map<String, JSONObject> fetched = fetchMetadataBatch(chunk, false);
                check();
                if (!accountStillNeedsBackfill(accountId)) return true;

                Set<String> pending = pendingResourceIds(accountId, chunk);
                List<Object[]> txStatements = new ArrayList<>();
                for (String id : chunk) {
                    if (!pending.contains(id)) {
                        JSONObject thread = fetched.get(id);
                        if (thread != null) txStatements.addAll(buildThreadStorageStatements(accountId, thread));
                    }
                    storedIdsJson.put(id);
                    completed++;
                }
                checkpoint.put("completed", completed);
                txStatements.add(new Object[]{
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
                    key,
                    checkpoint.toString(),
                });
                AppDatabase.transaction(context, txStatements.toArray(new Object[0][]));
            }

            String nextPageToken = listResponse.optString("nextPageToken", "");
            if (nextPageToken.isEmpty()) break;
            checkpoint.put("pageToken", nextPageToken);
            checkpoint.put("storedIds", new JSONArray());
            check();
            if (!accountStillNeedsBackfill(accountId)) return true;
            saveCheckpoint(key, checkpoint);
        }

        check();
        AppDatabase.transaction(context,
            new Object[]{
                "UPDATE accounts SET history_id = $1, last_sync_at = unixepoch(), updated_at = unixepoch() WHERE id = $2",
                checkpoint.getString("historyId"),
                accountId,
            },
            new Object[]{
                "INSERT INTO settings (key, value) VALUES ($1, '') ON CONFLICT(key) DO UPDATE SET value = ''",
                key,
            }
        );
        return true;
    }

    @NonNull @Override public Result doWork() {
        if (!BackgroundMailScheduler.enabled(context) || BackgroundMailScheduler.foreground) return Result.success();
        File file = new File(context.getFilesDir(), "suitemail.db");
        if (!file.exists()) return Result.success();

        long deadline = System.currentTimeMillis() + RUN_BUDGET_MS;
        boolean needRetry = false;
        try {
            JSONArray accounts = AppDatabase.select(context,
                "SELECT id, email FROM accounts WHERE is_active = 1 AND provider = 'gmail_api' AND (history_id IS NULL OR history_id = '') ORDER BY id");
            if (accounts.length() == 0) return Result.success();

            int daysBack = readSyncPeriodDays();
            for (int i = 0; i < accounts.length(); i++) {
                JSONObject account = accounts.getJSONObject(i);
                String id = AppDatabase.string(account, "id");
                String accountEmail = AppDatabase.string(account, "email");
                if (id == null || accountEmail == null) continue;
                try {
                    if (!backfillAccount(id, accountEmail, daysBack, deadline)) needRetry = true;
                } catch (Paused e) {
                    return Result.success();
                } catch (Reconnect e) {
                    // Don't spin WorkManager retries when user action is needed to re-authenticate.
                } catch (RateLimited e) {
                    needRetry = true;
                } catch (Exception e) {
                    Throwable cause = e.getCause();
                    ApiException api = e instanceof ApiException ? (ApiException) e : cause instanceof ApiException ? (ApiException) cause : null;
                    int code = api == null ? -1 : api.getStatusCode();
                    boolean authFailure = code == 4 || code == 10 || code == 16 || code == 12500 || code == 12501
                        || (e instanceof HttpError && (((HttpError) e).status == 401 || ((HttpError) e).status == 403));
                    if (!authFailure) needRetry = true;
                }
            }
            return needRetry ? Result.retry() : Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }
}
