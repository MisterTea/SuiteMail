package com.suitemail.app;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class AppDatabaseTest {
    @Test public void selectArgsUseNumberedPlaceholdersAndKeepNulls() throws Exception {
        JSONObject args = AppDatabase.selectArgs("SELECT value FROM settings WHERE key=$1 AND x=$2", "gmail_initial_sync:a1", null);
        assertEquals("SELECT value FROM settings WHERE key=$1 AND x=$2", args.getString("query"));
        JSONArray params = args.getJSONArray("params");
        assertEquals("gmail_initial_sync:a1", params.getString(0));
        assertTrue(params.isNull(1));
        assertEquals(0, AppDatabase.selectArgs("SELECT 1").getJSONArray("params").length());
    }

    @Test public void transactionArgsCarryEveryStatementInOrder() throws Exception {
        JSONArray statements = AppDatabase.transactionArgs(
            new Object[]{"UPDATE a SET s=$1 WHERE id=$2", "sent", "r1"},
            new Object[]{"DELETE FROM b"}).getJSONArray("statements");
        assertEquals(2, statements.length());
        assertEquals("UPDATE a SET s=$1 WHERE id=$2", statements.getJSONObject(0).getString("query"));
        assertEquals("r1", statements.getJSONObject(0).getJSONArray("params").getString(1));
        assertEquals(0, statements.getJSONObject(1).getJSONArray("params").length());
    }

    @Test public void valueUnwrapsRowsAndThrowsCoreErrors() throws Exception {
        JSONArray rows = (JSONArray) AppDatabase.value("{\"value\":[{\"id\":\"a1\",\"history_id\":12345,\"email\":null}]}");
        JSONObject row = rows.getJSONObject(0);
        assertEquals("a1", AppDatabase.string(row, "id"));
        assertEquals("12345", AppDatabase.string(row, "history_id"));
        assertNull(AppDatabase.string(row, "email"));
        assertNull(AppDatabase.value("{\"value\":null}"));
        try { AppDatabase.value("{\"error\":\"Another transaction is in progress\"}"); fail(); }
        catch (IllegalStateException expected) { assertEquals("Another transaction is in progress", expected.getMessage()); }
    }
}
