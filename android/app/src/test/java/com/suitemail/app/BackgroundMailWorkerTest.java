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
}
