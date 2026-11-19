use crate::ai_backend;
use crate::commands;
use crate::oauth;
use serde_json::{json, Value};

pub async fn dispatch(cmd: &str, args: Value) -> Result<Value, String> {
    match cmd {
        "imap_test_connection" => {
            let config = serde_json::from_value(args.get("config").cloned().unwrap_or(args))
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let res = commands::imap_test_connection(config).await?;
            Ok(json!(res))
        }
        "imap_list_folders" => {
            let config = serde_json::from_value(args.get("config").cloned().unwrap_or(args))
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let res = commands::imap_list_folders(config).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_fetch_messages" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uids: Vec<u32> = serde_json::from_value(args["uids"].clone())
                .map_err(|e| format!("Invalid uids: {e}"))?;
            let res = commands::imap_fetch_messages(config, folder, uids).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_fetch_new_uids" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let since_uid: u32 = serde_json::from_value(args["since_uid"].clone())
                .map_err(|e| format!("Invalid since_uid: {e}"))?;
            let res = commands::imap_fetch_new_uids(config, folder, since_uid).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_search_all_uids" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let res = commands::imap_search_all_uids(config, folder).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_fetch_message_body" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uid: u32 = serde_json::from_value(args["uid"].clone())
                .map_err(|e| format!("Invalid uid: {e}"))?;
            let res = commands::imap_fetch_message_body(config, folder, uid).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_fetch_raw_message" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uid: u32 = serde_json::from_value(args["uid"].clone())
                .map_err(|e| format!("Invalid uid: {e}"))?;
            let res = commands::imap_fetch_raw_message(config, folder, uid).await?;
            Ok(json!(res))
        }
        "imap_set_flags" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uids: Vec<u32> = serde_json::from_value(args["uids"].clone())
                .map_err(|e| format!("Invalid uids: {e}"))?;
            let flags: Vec<String> = serde_json::from_value(args["flags"].clone())
                .map_err(|e| format!("Invalid flags: {e}"))?;
            let add: bool = serde_json::from_value(args["add"].clone())
                .map_err(|e| format!("Invalid add flag: {e}"))?;
            commands::imap_set_flags(config, folder, uids, flags, add).await?;
            Ok(Value::Null)
        }
        "imap_move_messages" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uids: Vec<u32> = serde_json::from_value(args["uids"].clone())
                .map_err(|e| format!("Invalid uids: {e}"))?;
            let destination: String = serde_json::from_value(args["destination"].clone())
                .map_err(|e| format!("Invalid destination: {e}"))?;
            commands::imap_move_messages(config, folder, uids, destination).await?;
            Ok(Value::Null)
        }
        "imap_delete_messages" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uids: Vec<u32> = serde_json::from_value(args["uids"].clone())
                .map_err(|e| format!("Invalid uids: {e}"))?;
            commands::imap_delete_messages(config, folder, uids).await?;
            Ok(Value::Null)
        }
        "imap_get_folder_status" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let res = commands::imap_get_folder_status(config, folder).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_fetch_attachment" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uid: u32 = serde_json::from_value(args["uid"].clone())
                .map_err(|e| format!("Invalid uid: {e}"))?;
            let part_id: String = serde_json::from_value(args["part_id"].clone())
                .map_err(|e| format!("Invalid part_id: {e}"))?;
            let res = commands::imap_fetch_attachment(config, folder, uid, part_id).await?;
            Ok(json!(res))
        }
        "imap_create_folder" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            commands::imap_create_folder(config, folder).await?;
            Ok(Value::Null)
        }
        "imap_append_message" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let flags: Option<String> = serde_json::from_value(args["flags"].clone()).ok();
            let raw_message: String = serde_json::from_value(args["raw_message"].clone())
                .map_err(|e| format!("Invalid raw_message: {e}"))?;
            commands::imap_append_message(config, folder, flags, raw_message).await?;
            Ok(Value::Null)
        }
        "imap_search_folder" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let since_date: Option<String> = serde_json::from_value(args["since_date"].clone()).ok();
            let res = commands::imap_search_folder(config, folder, since_date).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_sync_folder" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let batch_size: u32 = serde_json::from_value(args["batch_size"].clone())
                .unwrap_or(50);
            let since_date: Option<String> = serde_json::from_value(args["since_date"].clone()).ok();
            let res = commands::imap_sync_folder(config, folder, batch_size, since_date).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "imap_raw_fetch_diagnostic" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folder: String = serde_json::from_value(args["folder"].clone())
                .map_err(|e| format!("Invalid folder: {e}"))?;
            let uid_range: String = serde_json::from_value(args["uid_range"].clone())
                .map_err(|e| format!("Invalid uid_range: {e}"))?;
            let res = commands::imap_raw_fetch_diagnostic(config, folder, uid_range).await?;
            Ok(json!(res))
        }
        "imap_delta_check" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid ImapConfig: {e}"))?;
            let folders = serde_json::from_value(args["folders"].clone())
                .map_err(|e| format!("Invalid folders array: {e}"))?;
            let res = commands::imap_delta_check(config, folders).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "smtp_send_email" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid SmtpConfig: {e}"))?;
            let raw_email: String = serde_json::from_value(args["raw_email"].clone())
                .map_err(|e| format!("Invalid raw_email: {e}"))?;
            let res = commands::smtp_send_email(config, raw_email).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "smtp_test_connection" => {
            let config = serde_json::from_value(args["config"].clone())
                .map_err(|e| format!("Invalid SmtpConfig: {e}"))?;
            let res = commands::smtp_test_connection(config).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "check_proton_bridge_status" => {
            let custom_imap_port = args.get("custom_imap_port").and_then(|v| v.as_u64()).map(|p| p as u16);
            let custom_smtp_port = args.get("custom_smtp_port").and_then(|v| v.as_u64()).map(|p| p as u16);
            let res = commands::check_proton_bridge_status(custom_imap_port, custom_smtp_port).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "launch_proton_bridge" => {
            let res = commands::launch_proton_bridge().await?;
            Ok(json!(res))
        }
        "start_oauth_server" => {
            let port = args.get("port").and_then(|v| v.as_u64()).unwrap_or(17248) as u16;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = oauth::start_oauth_server(port, state).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "oauth_exchange_token" => {
            let token_url = args["token_url"].as_str().unwrap_or("").to_string();
            let code = args["code"].as_str().unwrap_or("").to_string();
            let client_id = args["client_id"].as_str().unwrap_or("").to_string();
            let redirect_uri = args["redirect_uri"].as_str().unwrap_or("").to_string();
            let code_verifier = args.get("code_verifier").and_then(|v| v.as_str()).map(String::from);
            let client_secret = args.get("client_secret").and_then(|v| v.as_str()).map(String::from);
            let scope = args.get("scope").and_then(|v| v.as_str()).map(String::from);
            let res = oauth::oauth_exchange_token(
                token_url,
                code,
                client_id,
                redirect_uri,
                code_verifier,
                client_secret,
                scope,
            ).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "oauth_refresh_token" => {
            let token_url = args["token_url"].as_str().unwrap_or("").to_string();
            let refresh_token = args["refresh_token"].as_str().unwrap_or("").to_string();
            let client_id = args["client_id"].as_str().unwrap_or("").to_string();
            let client_secret = args.get("client_secret").and_then(|v| v.as_str()).map(String::from);
            let scope = args.get("scope").and_then(|v| v.as_str()).map(String::from);
            let res = oauth::oauth_refresh_token(
                token_url,
                refresh_token,
                client_id,
                client_secret,
                scope,
            ).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "start_llama_server" => {
            let model_id = args.get("model_id").and_then(|v| v.as_str()).map(String::from);
            let port = args.get("port").and_then(|v| v.as_u64()).map(|p| p as u16);
            let res = ai_backend::start_llama_server(model_id, port).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "stop_llama_server" => {
            ai_backend::stop_llama_server().await?;
            Ok(Value::Null)
        }
        "get_llama_server_status" => {
            let port = args.get("port").and_then(|v| v.as_u64()).map(|p| p as u16);
            let res = ai_backend::get_llama_server_status(port).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "aicore_is_available" => {
            let res = ai_backend::aicore_is_available().await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "aicore_generate" => {
            let system_prompt = args["system_prompt"].as_str().unwrap_or("").to_string();
            let prompt = args["prompt"].as_str().unwrap_or("").to_string();
            let model = args.get("model").and_then(|v| v.as_str()).map(String::from);
            let res = ai_backend::aicore_generate(system_prompt, prompt, model).await?;
            Ok(json!(res))
        }
        "close_splashscreen" | "set_tray_tooltip" | "open_devtools" => {
            // Handled directly in Electron main process; safe no-op if invoked here
            Ok(Value::Null)
        }
        other => Err(format!("Command '{other}' not implemented in Rust core")),
    }
}
