#![cfg(target_os = "android")]

use jni::{
    objects::{JClass, JString},
    sys::jstring,
    JNIEnv,
};
use serde_json::{json, Value};
use std::sync::OnceLock;

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn dispatch(command: &str, args: Value) -> Result<Value, String> {
    match command {
        "db_init" => {
            let path = args["path"].as_str().ok_or("Missing database path")?;
            supermail_core::db::init_db(path.into())?;
            Ok(Value::Null)
        }
        "db_select" | "db_execute" => {
            let query = args["query"].as_str().ok_or("Missing query")?;
            let params = args["params"].as_array().cloned().unwrap_or_default();
            if command == "db_select" {
                supermail_core::db::db_select(query, params)
            } else {
                supermail_core::db::db_execute(query, params)
            }
        }
        "db_transaction" => {
            let statements = args["statements"]
                .as_array()
                .ok_or("Missing statements")?
                .iter()
                .map(|statement| {
                    Ok((
                        statement["query"].as_str().ok_or("Missing query")?.to_string(),
                        statement["params"].as_array().cloned().unwrap_or_default(),
                    ))
                })
                .collect::<Result<Vec<_>, String>>()?;
            supermail_core::db::db_transaction(statements)
        }
        "aicore_is_available" => Ok(json!({"available": false, "supported_models": []})),
        "aicore_generate" => Err(
            "On-device AI is not implemented. Configure a cloud AI provider in Settings.".into(),
        ),
        "launch_proton_bridge" | "check_proton_bridge_status" => {
            Err("Proton Bridge requires a desktop computer.".into())
        }
        _ => RUNTIME
            .get_or_init(|| tokio::runtime::Runtime::new().expect("Tokio runtime"))
            .block_on(supermail_core::dispatcher::dispatch(command, args)),
    }
}

// All JNI failures are returned as JSON; Rust panics must never unwind across JNI.
#[no_mangle]
pub extern "system" fn Java_com_suitemail_app_SuiteMailPlugin_nativeCall(
    mut env: JNIEnv,
    _class: JClass,
    command: JString,
    arguments: JString,
) -> jstring {
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Value, String> {
            let command: String = env.get_string(&command).map_err(|e| e.to_string())?.into();
            let arguments: String = env
                .get_string(&arguments)
                .map_err(|e| e.to_string())?
                .into();
            dispatch(
                &command,
                serde_json::from_str(&arguments).map_err(|e| e.to_string())?,
            )
        }));
    let envelope = match result {
        Ok(Ok(value)) => json!({"value": value}),
        Ok(Err(error)) => json!({"error": error}),
        Err(_) => json!({"error": "Native backend failed"}),
    };
    env.new_string(envelope.to_string())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
