#![cfg(target_os = "ios")]

use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};
use std::sync::OnceLock;

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();

fn dispatch(command: &str, args: Value) -> Result<Value, String> {
    let string = |name| args[name].as_str().ok_or_else(|| format!("Missing {name}"));
    match command {
        "db_init" => {
            supermail_core::db::init_db(string("path")?.into())?;
            Ok(Value::Null)
        }
        "db_select" | "db_execute" => {
            let query = string("query")?;
            let params = args["params"].as_array().cloned().unwrap_or_default();
            if command == "db_select" {
                supermail_core::db::db_select(query, params)
            } else {
                supermail_core::db::db_execute(query, params)
            }
        }
        command if command.starts_with("imap_") || command.starts_with("smtp_") => RUNTIME
            .get_or_init(|| tokio::runtime::Runtime::new().expect("Tokio runtime"))
            .block_on(supermail_core::dispatcher::dispatch(command, args)),
        _ => Err(format!("Command '{command}' is unavailable on iOS")),
    }
}

/// # Safety
/// Both arguments must be non-null, valid NUL-terminated strings for the call.
/// Release the returned string with `suitemail_ios_free`.
#[no_mangle]
pub unsafe extern "C" fn suitemail_ios_call(
    command: *const c_char,
    args: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<Value, String> {
        let command = CStr::from_ptr(command)
            .to_str()
            .map_err(|e| e.to_string())?;
        let args =
            serde_json::from_slice(CStr::from_ptr(args).to_bytes()).map_err(|e| e.to_string())?;
        dispatch(command, args)
    });
    let response = match result {
        Ok(Ok(value)) => json!({"value": value}),
        Ok(Err(error)) => json!({"error": error}),
        Err(_) => json!({"error": "Native backend failed"}),
    };
    CString::new(response.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// # Safety
/// Pass a pointer returned by `suitemail_ios_call` exactly once.
#[no_mangle]
pub unsafe extern "C" fn suitemail_ios_free(result: *mut c_char) {
    if !result.is_null() {
        drop(CString::from_raw(result));
    }
}
