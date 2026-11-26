package com.suitemail.app;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The only way native code reads or writes suitemail.db: through the app's own Rust connection
 * (SuiteMailPlugin.databaseCall), which also initializes it when WorkManager cold-starts the process.
 * Never open suitemail.db with android.database.sqlite: two SQLite copies in one process defeat SQLite's
 * locking and can delete the live WAL (https://sqlite.org/howtocorrupt.html#multiple_copies_of_sqlite_linked_into_the_same_application).
 */
final class AppDatabase {
    private AppDatabase() {}

    /** Rows as JSON objects keyed by column name. Placeholders are $1, $2, ... */
    static JSONArray select(Context context, String query, Object... params) throws Exception {
        JSONArray rows = (JSONArray) value(SuiteMailPlugin.databaseCall(context, "db_select", selectArgs(query, params).toString()));
        return rows == null ? new JSONArray() : rows;
    }

    /**
     * Runs each {query, params...} statement in one committed transaction. Fails, running nothing, if the
     * app has its own transaction open, so this work can never be rolled back by someone else's ROLLBACK.
     * Returns the rows affected by each statement.
     */
    static JSONArray transaction(Context context, Object[]... statements) throws Exception {
        return (JSONArray) value(SuiteMailPlugin.databaseCall(context, "db_transaction", transactionArgs(statements).toString()));
    }

    static JSONObject selectArgs(String query, Object... params) throws Exception {
        return new JSONObject().put("query", query).put("params", params(params, 0));
    }

    static JSONObject transactionArgs(Object[]... statements) throws Exception {
        JSONArray list = new JSONArray();
        for (Object[] statement : statements)
            list.put(new JSONObject().put("query", statement[0]).put("params", params(statement, 1)));
        return new JSONObject().put("statements", list);
    }

    private static JSONArray params(Object[] values, int from) {
        JSONArray params = new JSONArray();
        for (int i = from; i < values.length; i++) params.put(values[i] == null ? JSONObject.NULL : values[i]);
        return params;
    }

    /** Unwraps the core's {value} / {error} reply. */
    static Object value(String envelope) throws Exception {
        JSONObject reply = new JSONObject(envelope);
        if (reply.has("error")) throw new IllegalStateException(reply.getString("error"));
        Object value = reply.opt("value");
        return value == JSONObject.NULL ? null : value;
    }

    /** A column that may be SQL NULL. */
    static String string(JSONObject row, String column) {
        return row.isNull(column) ? null : String.valueOf(row.opt(column));
    }
}
