package com.suitemail.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class BackgroundBackfillWorkerTest {
    @Test public void buildsAndParsesMultipartBatchRequests() {
        String body = BackgroundBackfillWorker.buildBatchBody("b123", Arrays.asList("t1", "t2"));
        assertTrue(body.contains("--b123\r\nContent-Type: application/http\r\nContent-ID: <0>\r\n\r\nGET /gmail/v1/users/me/threads/t1?format=metadata"));
        assertTrue(body.contains("Content-ID: <1>\r\n\r\nGET /gmail/v1/users/me/threads/t2?format=metadata"));
        assertTrue(body.endsWith("--b123--\r\n"));

        String response =
            "--resp_bound\r\n" +
            "Content-Type: application/http\r\n" +
            "Content-ID: <response-0>\r\n\r\n" +
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" +
            "{\"id\":\"t1\",\"messages\":[]}\r\n" +
            "--resp_bound\r\n" +
            "Content-Type: application/http\r\n" +
            "Content-ID: <response-1>\r\n\r\n" +
            "HTTP/1.1 404 Not Found\r\n\r\n" +
            "{\"error\":{\"code\":404}}\r\n" +
            "--resp_bound--\r\n";

        Map<String, BackgroundBackfillWorker.BatchPart> parsed =
            BackgroundBackfillWorker.parseBatchResponse("multipart/mixed; boundary=resp_bound", response);
        assertEquals(2, parsed.size());
        assertEquals(200, parsed.get("0").status);
        assertEquals("{\"id\":\"t1\",\"messages\":[]}", parsed.get("0").body);
        assertEquals(404, parsed.get("1").status);
    }

    @Test public void parsesCheckpointsMatchingFrontendSchema() throws Exception {
        String valid = new JSONObject()
            .put("version", 1)
            .put("daysBack", 365)
            .put("query", "after:2025/11/27")
            .put("historyId", "999")
            .put("completed", 25)
            .put("total", 500)
            .put("storedIds", new JSONArray().put("t1"))
            .toString();

        assertNotNull(BackgroundBackfillWorker.parseCheckpoint(valid, 365));
        assertNull(BackgroundBackfillWorker.parseCheckpoint(valid, 90));
        assertNull(BackgroundBackfillWorker.parseCheckpoint("", 365));
        assertNull(BackgroundBackfillWorker.parseCheckpoint("{\"version\":2}", 365));
    }

    @Test public void buildsQueryAndParsesAddressesLikeMessageParser() {
        Calendar cal = new GregorianCalendar(2026, Calendar.NOVEMBER, 27);
        assertEquals("after:2025/11/27", BackgroundBackfillWorker.buildQuery(365, cal));

        String[] named = BackgroundBackfillWorker.parseEmailAddress("\"Alice Smith\" <alice@example.com>");
        assertEquals("Alice Smith", named[0]);
        assertEquals("alice@example.com", named[1]);

        String[] bare = BackgroundBackfillWorker.parseEmailAddress("bob@example.com");
        assertNull(bare[0]);
        assertEquals("bob@example.com", bare[1]);
    }

    @Test public void buildsThreadMetadataStorageStatementsWithoutWipingBodies() throws Exception {
        JSONObject thread = new JSONObject()
            .put("id", "t1")
            .put("messages", new JSONArray()
                .put(new JSONObject()
                    .put("id", "m1")
                    .put("threadId", "t1")
                    .put("internalDate", "1700000000000")
                    .put("sizeEstimate", 1234)
                    .put("snippet", "First snippet")
                    .put("labelIds", new JSONArray().put("INBOX").put("IMPORTANT"))
                    .put("payload", new JSONObject()
                        .put("mimeType", "multipart/mixed")
                        .put("headers", new JSONArray()
                            .put(new JSONObject().put("name", "From").put("value", "Alice <alice@example.com>"))
                            .put(new JSONObject().put("name", "Subject").put("value", "Hello")))))
                .put(new JSONObject()
                    .put("id", "m2")
                    .put("threadId", "t1")
                    .put("internalDate", "1700000060000")
                    .put("sizeEstimate", 567)
                    .put("snippet", "Reply snippet")
                    .put("labelIds", new JSONArray().put("INBOX").put("UNREAD").put("STARRED"))
                    .put("payload", new JSONObject()
                        .put("mimeType", "text/plain")
                        .put("headers", new JSONArray()
                            .put(new JSONObject().put("name", "From").put("value", "bob@example.com"))
                            .put(new JSONObject().put("name", "Subject").put("value", "Re: Hello"))))));

        List<Object[]> stmts = BackgroundBackfillWorker.buildThreadStorageStatements("acc1", thread);
        // 1 thread upsert + 1 delete labels + 4 label inserts (INBOX, IMPORTANT, UNREAD, STARRED) + 2 message upserts + 1 orphan cleanup
        assertEquals(9, stmts.size());

        Object[] threadUpsert = stmts.get(0);
        assertTrue(((String) threadUpsert[0]).contains("INSERT INTO threads"));
        assertEquals("t1", threadUpsert[1]);
        assertEquals("acc1", threadUpsert[2]);
        assertEquals("Hello", threadUpsert[3]);
        assertEquals("Reply snippet", threadUpsert[4]);
        assertEquals(1700000060000L, threadUpsert[5]);
        assertEquals(2, threadUpsert[6]);
        assertEquals(0, threadUpsert[7]); // is_read = false (m2 is UNREAD)
        assertEquals(1, threadUpsert[8]); // is_starred = true
        assertEquals(1, threadUpsert[9]); // is_important = true
        assertEquals(1, threadUpsert[10]); // has_attachments = true (m1 is multipart/mixed)

        Object[] msg1Upsert = stmts.get(6);
        String msgSql = (String) msg1Upsert[0];
        assertTrue(msgSql.contains("INSERT INTO messages"));
        // On conflict, must not overwrite body_html, body_text, or body_cached
        String onConflict = msgSql.substring(msgSql.indexOf("ON CONFLICT"));
        assertFalse(onConflict.contains("body_html"));
        assertFalse(onConflict.contains("body_text"));
        assertFalse(onConflict.contains("body_cached"));

        Object[] orphanDelete = stmts.get(8);
        assertTrue(((String) orphanDelete[0]).contains("DELETE FROM messages WHERE account_id = $1 AND thread_id = $2 AND id NOT IN ($3,$4)"));
        assertEquals("m1", orphanDelete[3]);
        assertEquals("m2", orphanDelete[4]);
    }

    @Test public void buildsValidExpeditedBackfillWorkRequest() {
        androidx.work.OneTimeWorkRequest req = BackgroundMailScheduler.buildBackfillRequest();
        assertNotNull(req);
        assertTrue(req.getTags().contains(BackgroundMailScheduler.BACKFILL_TAG));
    }

    @Test public void formatsBackfillNotificationProgressText() {
        assertEquals("Syncing older mail…", BackgroundBackfillWorker.formatProgressText(0, 0));
        assertTrue(BackgroundBackfillWorker.formatProgressText(4610, 4860).contains("4,610"));
        assertTrue(BackgroundBackfillWorker.formatProgressText(4610, 4860).contains("4,860"));
        assertTrue(BackgroundBackfillWorker.formatProgressText(500, 0).contains("500"));
    }
}
