package com.suitemail.app;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class BackgroundMailWorkerTest {
    private static JSONObject added(String id,String threadId) throws Exception {
        return new JSONObject().put("messagesAdded",new JSONArray().put(new JSONObject().put("message",
            new JSONObject().put("id",id).put("threadId",threadId))));
    }

    @Test public void fetchesNewConversationsAsOneMessageAndRepliesAsThreads() throws Exception {
        JSONObject changes=new JSONObject().put("history",new JSONArray()
            .put(added("new1","new1"))      // brand-new conversation
            .put(added("reply1","old1"))    // reply in an existing thread
            .put(added("new2","new2"))
            .put(added("reply2","new2")));  // new conversation that already has a reply
        assertEquals(Arrays.asList("new2","old1","m:new1"),BackgroundMailWorker.downloadsFor(changes));
    }

    @Test public void ordersThreadsByLatestActivityAndIgnoresEmptyPages() throws Exception {
        JSONObject changes=new JSONObject().put("history",new JSONArray()
            .put(added("a2","a1")).put(added("b1","b1")).put(added("a3","a1")));
        assertEquals(Arrays.asList("a1","m:b1"),BackgroundMailWorker.downloadsFor(changes));
        assertTrue(BackgroundMailWorker.downloadsFor(new JSONObject().put("historyId","9")).isEmpty());
    }

    @Test public void wrapsASingleMessageAsAPartialThread() throws Exception {
        JSONObject message=new JSONObject().put("id","t1").put("threadId","t1").put("historyId","42");
        JSONObject thread=BackgroundMailWorker.singleMessageThread(message);
        assertEquals("t1",thread.getString("id"));
        assertEquals("42",thread.getString("historyId"));
        assertTrue(thread.getBoolean("partial"));
        assertEquals("t1",thread.getJSONArray("messages").getJSONObject(0).getString("id"));
    }

    @Test public void schedulesBackgroundSyncEveryThirtyMinutes() {
        assertEquals(30, BackgroundMailScheduler.INTERVAL_MINUTES);
    }

    @Test public void parsesSenderHeadersAndQuietHours() {
        String[] named = BackgroundMailWorker.parseSender("\"Brian Baraty\" <Brian@Example.com>");
        assertEquals("Brian Baraty", named[0]);
        assertEquals("brian@example.com", named[1]);

        String[] bare = BackgroundMailWorker.parseSender("alice@example.com");
        assertEquals("alice@example.com", bare[0]);
        assertEquals("alice@example.com", bare[1]);

        assertTrue(BackgroundMailWorker.isWithinQuietHours("22:00", "07:00", 23, 30));
        assertTrue(BackgroundMailWorker.isWithinQuietHours("22:00", "07:00", 6, 45));
        assertFalse(BackgroundMailWorker.isWithinQuietHours("22:00", "07:00", 12, 0));
        assertTrue(BackgroundMailWorker.isWithinQuietHours("09:00", "17:00", 12, 0));
        assertFalse(BackgroundMailWorker.isWithinQuietHours("09:00", "17:00", 18, 0));
    }

    @Test public void extractsOnlyUnreadInboxMessagesNotFromSelf() throws Exception {
        JSONObject msg = new JSONObject()
            .put("id", "m1")
            .put("threadId", "t1")
            .put("internalDate", "1704067200000")
            .put("snippet", "Hello   there")
            .put("labelIds", new JSONArray().put("INBOX").put("UNREAD"))
            .put("payload", new JSONObject().put("headers", new JSONArray()
                .put(new JSONObject().put("name", "From").put("value", "Brian Baraty <brian@example.com>"))
                .put(new JSONObject().put("name", "Subject").put("value", "Happy Thanksgiving"))));
        BackgroundMailWorker.NotifiableMessage note = BackgroundMailWorker.extractNotifiableMessage(
            BackgroundMailWorker.singleMessageThread(msg), "me@example.com"
        );
        assertNotNull(note);
        assertEquals("m1", note.messageId);
        assertEquals("t1", note.threadId);
        assertEquals("Brian Baraty", note.fromName);
        assertEquals("brian@example.com", note.fromAddress);
        assertEquals("Happy Thanksgiving", note.subject);
        assertEquals("Hello there", note.snippet);
        assertEquals(1704067200000L, note.timestampMs);

        // Self-sent should be ignored
        assertNull(BackgroundMailWorker.extractNotifiableMessage(
            BackgroundMailWorker.singleMessageThread(msg), "brian@example.com"
        ));

        // Read message should be ignored
        msg.put("labelIds", new JSONArray().put("INBOX"));
        assertNull(BackgroundMailWorker.extractNotifiableMessage(
            BackgroundMailWorker.singleMessageThread(msg), "me@example.com"
        ));
    }
}
