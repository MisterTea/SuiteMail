use rusqlite::{params_from_iter, types::ValueRef, Connection, OpenFlags, Row, ToSql};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

static DB_CONN: Mutex<Option<Connection>> = Mutex::new(None);

pub fn init_db(db_path: PathBuf) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open database at {:?}: {}", db_path, e))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| format!("Failed to configure PRAGMAs: {}", e))?;

    let mut guard = DB_CONN.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    log::info!("SQLite database initialized successfully at {:?}", db_path);
    Ok(())
}

fn row_value_to_json(row: &Row, i: usize) -> Result<Value, rusqlite::Error> {
    match row.get_ref(i)? {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(n) => Ok(json!(n)),
        ValueRef::Real(f) => {
            if let Some(num) = serde_json::Number::from_f64(f) {
                Ok(Value::Number(num))
            } else {
                Ok(Value::Null)
            }
        }
        ValueRef::Text(bytes) => {
            let s = std::str::from_utf8(bytes).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    i,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;
            Ok(Value::String(s.to_string()))
        }
        ValueRef::Blob(bytes) => {
            Ok(Value::Array(bytes.iter().map(|b| json!(*b)).collect()))
        }
    }
}

enum DynamicSqlParam {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
}

impl ToSql for DynamicSqlParam {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        match self {
            DynamicSqlParam::Null => Ok(rusqlite::types::ToSqlOutput::from(rusqlite::types::Null)),
            DynamicSqlParam::Integer(i) => Ok(rusqlite::types::ToSqlOutput::from(*i)),
            DynamicSqlParam::Real(f) => Ok(rusqlite::types::ToSqlOutput::from(*f)),
            DynamicSqlParam::Text(s) => Ok(rusqlite::types::ToSqlOutput::from(s.as_str())),
        }
    }
}

fn json_value_to_param(val: Value) -> DynamicSqlParam {
    match val {
        Value::Null => DynamicSqlParam::Null,
        Value::Bool(b) => DynamicSqlParam::Integer(if b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                DynamicSqlParam::Integer(i)
            } else if let Some(f) = n.as_f64() {
                DynamicSqlParam::Real(f)
            } else {
                DynamicSqlParam::Null
            }
        }
        Value::String(s) => DynamicSqlParam::Text(s),
        Value::Array(_) | Value::Object(_) => DynamicSqlParam::Text(val.to_string()),
    }
}

pub fn normalize_query(query: &str) -> String {
    let mut out = String::with_capacity(query.len());
    let mut chars = query.chars().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    while let Some(c) = chars.next() {
        if in_single_quote {
            out.push(c);
            if c == '\'' {
                if chars.peek() == Some(&'\'') {
                    out.push(chars.next().unwrap());
                } else {
                    in_single_quote = false;
                }
            }
        } else if in_double_quote {
            out.push(c);
            if c == '"' {
                in_double_quote = false;
            }
        } else {
            match c {
                '\'' => {
                    in_single_quote = true;
                    out.push(c);
                }
                '"' => {
                    in_double_quote = true;
                    out.push(c);
                }
                '$' => {
                    if let Some(&next_c) = chars.peek() {
                        if next_c.is_ascii_digit() {
                            out.push('?');
                            continue;
                        }
                    }
                    out.push(c);
                }
                _ => out.push(c),
            }
        }
    }
    out
}

pub fn db_select(query: &str, params: Vec<Value>) -> Result<Value, String> {
    let guard = DB_CONN.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let normalized = normalize_query(query);
    let mut stmt = conn
        .prepare(&normalized)
        .map_err(|e| format!("Query prepare error: {e} in {normalized}"))?;
    let col_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

    let sql_params: Vec<DynamicSqlParam> = params.into_iter().map(json_value_to_param).collect();
    let rows = stmt
        .query_map(params_from_iter(sql_params.iter()), |row| {
            let mut obj = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val = row_value_to_json(row, i)?;
                obj.insert(name.clone(), val);
            }
            Ok(Value::Object(obj))
        })
        .map_err(|e| format!("Query map error: {e} in {normalized}"))?;

    let mut results = Vec::new();
    for r in rows {
        results.push(r.map_err(|e| format!("Row parse error: {e}"))?);
    }
    Ok(Value::Array(results))
}

pub fn db_execute(query: &str, params: Vec<Value>) -> Result<Value, String> {
    let guard = DB_CONN.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let normalized = normalize_query(query);
    let sql_params: Vec<DynamicSqlParam> = params.into_iter().map(json_value_to_param).collect();
    let rows_affected = conn
        .execute(&normalized, params_from_iter(sql_params.iter()))
        .map_err(|e| format!("Execute error: {e} in {normalized}"))?;

    let last_insert_id = conn.last_insert_rowid();

    Ok(json!({
        "rowsAffected": rows_affected,
        "lastInsertId": last_insert_id
    }))
}

/// Runs the statements as one committed transaction while holding the connection, so no other
/// caller's statements can interleave. Fails without running anything if another caller already has a
/// transaction open on this connection, so this work can never be rolled back by someone else.
/// Returns the rows affected by each statement.
pub fn db_transaction(statements: Vec<(String, Vec<Value>)>) -> Result<Value, String> {
    let guard = DB_CONN.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    if !conn.is_autocommit() {
        return Err("Another transaction is in progress".into());
    }
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("Execute error: {e} in BEGIN IMMEDIATE"))?;
    let mut affected = Vec::with_capacity(statements.len());
    for (query, params) in statements {
        let normalized = normalize_query(&query);
        let sql_params: Vec<DynamicSqlParam> = params.into_iter().map(json_value_to_param).collect();
        match conn.execute(&normalized, params_from_iter(sql_params.iter())) {
            Ok(rows) => affected.push(json!(rows)),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(format!("Execute error: {e} in {normalized}"));
            }
        }
    }
    if let Err(e) = conn.execute_batch("COMMIT") {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!("Execute error: {e} in COMMIT"));
    }
    Ok(Value::Array(affected))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_lifecycle_and_fts() {
        let temp_dir = std::env::temp_dir().join(format!("test_sm_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let db_path = temp_dir.join("test.db");
        init_db(db_path.clone()).unwrap();

        // Test positional parameter binding with $1, $2
        db_execute(
            "CREATE TABLE items (id TEXT PRIMARY KEY, count INTEGER, title TEXT);",
            vec![],
        )
        .unwrap();

        let insert_res = db_execute(
            "INSERT INTO items (id, count, title) VALUES ($1, $2, $3);",
            vec![json!("item-1"), json!(42), json!("Test Item")],
        )
        .unwrap();
        assert_eq!(insert_res["rowsAffected"], 1);

        let select_res = db_select(
            "SELECT * FROM items WHERE id = $1;",
            vec![json!("item-1")],
        )
        .unwrap();
        let rows = select_res.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], "item-1");
        assert_eq!(rows[0]["count"], 42);
        assert_eq!(rows[0]["title"], "Test Item");

        // Test out-of-order positional parameter binding ($2 appears before $1 in query)
        let select_out_of_order = db_select(
            "SELECT count as c FROM items WHERE title = $2 AND id = $1;",
            vec![json!("item-1"), json!("Test Item")],
        )
        .unwrap();
        let rows_ooo = select_out_of_order.as_array().unwrap();
        assert_eq!(rows_ooo.len(), 1);
        assert_eq!(rows_ooo[0]["c"], 42);

        // Test FTS5 table creation and querying
        db_execute(
            "CREATE VIRTUAL TABLE items_fts USING fts5(title, content='items', content_rowid='rowid');",
            vec![],
        )
        .unwrap();

        db_execute(
            "INSERT INTO items_fts(rowid, title) VALUES (1, 'Test Item');",
            vec![],
        )
        .unwrap();

        let fts_res = db_select(
            "SELECT * FROM items_fts WHERE items_fts MATCH 'Test*';",
            vec![],
        )
        .unwrap();
        assert_eq!(fts_res.as_array().unwrap().len(), 1);

        // Transactions: conditional updates report rows affected, and a failure rolls everything back.
        let claimed = db_transaction(vec![(
            "UPDATE items SET count = 43 WHERE id = $1 AND count = $2".into(),
            vec![json!("item-1"), json!(42)],
        )])
        .unwrap();
        assert_eq!(claimed, json!([1]));
        let again = db_transaction(vec![(
            "UPDATE items SET count = 44 WHERE id = $1 AND count = $2".into(),
            vec![json!("item-1"), json!(42)],
        )])
        .unwrap();
        assert_eq!(again, json!([0]));
        assert!(db_transaction(vec![
            ("UPDATE items SET count = 99 WHERE id = $1".into(), vec![json!("item-1")]),
            ("INSERT INTO missing_table VALUES (1)".into(), vec![]),
        ])
        .is_err());
        let count = db_select("SELECT count FROM items WHERE id = $1", vec![json!("item-1")]).unwrap();
        assert_eq!(count[0]["count"], 43);

        // Never joins (and so can never be rolled back by) a transaction someone else opened.
        db_execute("BEGIN", vec![]).unwrap();
        assert!(db_transaction(vec![("UPDATE items SET count = 1".into(), vec![])]).is_err());
        db_execute("ROLLBACK", vec![]).unwrap();

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
