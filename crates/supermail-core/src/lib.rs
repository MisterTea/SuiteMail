use napi_derive::napi;
use serde_json::Value;
use std::path::PathBuf;

pub mod db;
pub mod commands;
pub mod imap;
pub mod smtp;
pub mod proton_bridge;
pub mod ai_backend;
pub mod oauth;
pub mod dispatcher;

#[napi]
pub fn init_database(db_path: String) -> napi::Result<()> {
    db::init_db(PathBuf::from(db_path)).map_err(napi::Error::from_reason)
}

#[napi]
pub fn db_select(query: String, params_json: String) -> napi::Result<String> {
    let params: Vec<Value> = if params_json.trim().is_empty() {
        vec![]
    } else {
        serde_json::from_str(&params_json)
            .map_err(|e| napi::Error::from_reason(format!("Invalid params JSON: {e}")))?
    };

    let result = db::db_select(&query, params).map_err(napi::Error::from_reason)?;
    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub fn db_execute(query: String, params_json: String) -> napi::Result<String> {
    let params: Vec<Value> = if params_json.trim().is_empty() {
        vec![]
    } else {
        serde_json::from_str(&params_json)
            .map_err(|e| napi::Error::from_reason(format!("Invalid params JSON: {e}")))?
    };

    let result = db::db_execute(&query, params).map_err(napi::Error::from_reason)?;
    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}

#[napi]
pub async fn invoke(cmd: String, args_json: String) -> napi::Result<String> {
    let args: Value = if args_json.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&args_json)
            .map_err(|e| napi::Error::from_reason(format!("Invalid args JSON: {e}")))?
    };

    let result = dispatcher::dispatch(&cmd, args).await
        .map_err(napi::Error::from_reason)?;
    serde_json::to_string(&result).map_err(|e| napi::Error::from_reason(e.to_string()))
}
