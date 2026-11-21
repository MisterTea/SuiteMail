use crate::ai_backend;
use crate::commands;
use crate::ews;
#[cfg(feature = "graph")]
use crate::msgraph;
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
            let token_url = args.get("token_url").or_else(|| args.get("tokenUrl")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let code = args["code"].as_str().unwrap_or("").to_string();
            let client_id = args.get("client_id").or_else(|| args.get("clientId")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let redirect_uri = args.get("redirect_uri").or_else(|| args.get("redirectUri")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let code_verifier = args.get("code_verifier").or_else(|| args.get("codeVerifier")).and_then(|v| v.as_str()).map(String::from);
            let client_secret = args.get("client_secret").or_else(|| args.get("clientSecret")).and_then(|v| v.as_str()).map(String::from);
            let scope = args.get("scope").and_then(|v| v.as_str()).map(String::from);
            let res = oauth::oauth_exchange_token(
                token_url,
                code,
                client_id,
                redirect_uri,
                code_verifier,
                client_secret,
                scope,
                args.get("resource").and_then(|v| v.as_str()).map(String::from),
            ).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "oauth_refresh_token" => {
            let token_url = args.get("token_url").or_else(|| args.get("tokenUrl")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let refresh_token = args.get("refresh_token").or_else(|| args.get("refreshToken")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let client_id = args.get("client_id").or_else(|| args.get("clientId")).unwrap_or(&Value::Null).as_str().unwrap_or("").to_string();
            let client_secret = args.get("client_secret").or_else(|| args.get("clientSecret")).and_then(|v| v.as_str()).map(String::from);
            let scope = args.get("scope").and_then(|v| v.as_str()).map(String::from);
            let res = oauth::oauth_refresh_token(
                token_url,
                refresh_token,
                client_id,
                client_secret,
                scope,
                args.get("resource").and_then(|v| v.as_str()).map(String::from),
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
        "ews_ping" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            ews::ews_ping(token, anchor).await?;
            Ok(Value::Null)
        }
        "ews_list_folders" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let res = ews::ews_list_folders(token, anchor).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_sync_page" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let checkpoint = args["checkpoint"].as_str().unwrap_or("").to_string();
            let received_after = args.get("receivedAfter").or_else(|| args.get("received_after")).and_then(|v| v.as_str()).map(String::from);
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(40) as u32;
            let res = ews::ews_sync_page(token, anchor, checkpoint, received_after, limit).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_get_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_get_message(token, anchor, message_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_get_raw" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_get_raw(token, anchor, message_id).await?;
            Ok(json!(res))
        }
        "ews_get_attachment" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let attachment_id = args.get("attachmentId").or_else(|| args.get("attachment_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_get_attachment(token, anchor, attachment_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_move_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let destination = args["destination"].as_str().unwrap_or("").to_string();
            let res = ews::ews_move_message(token, anchor, message_id, destination).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_update_flags" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let is_read = args.get("isRead").or_else(|| args.get("is_read")).and_then(|v| v.as_bool());
            let flagged = args.get("flagged").and_then(|v| v.as_bool());
            ews::ews_update_flags(token, anchor, message_id, is_read, flagged).await?;
            Ok(Value::Null)
        }
        "ews_set_focused" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let focused = args["focused"].as_bool().unwrap_or(true);
            ews::ews_set_focused(token, anchor, message_id, focused).await?;
            Ok(Value::Null)
        }
        "ews_delete_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            ews::ews_delete_message(token, anchor, message_id).await?;
            Ok(Value::Null)
        }
        "ews_send_mime" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let raw_base64_url = args.get("rawBase64Url").or_else(|| args.get("raw_base64_url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_send_mime(token, anchor, raw_base64_url).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_create_draft_mime" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let raw_base64_url = args.get("rawBase64Url").or_else(|| args.get("raw_base64_url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_create_draft_mime(token, anchor, raw_base64_url).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_send_draft" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = ews::ews_send_draft(token, anchor, message_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_create_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let name = args["name"].as_str().unwrap_or("").to_string();
            let res = ews::ews_create_folder(token, anchor, name).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_rename_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let folder_id = args.get("folderId").or_else(|| args.get("folder_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = args["name"].as_str().unwrap_or("").to_string();
            let res = ews::ews_rename_folder(token, anchor, folder_id, name).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        "ews_delete_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let anchor = args["anchor"].as_str().unwrap_or("").to_string();
            let folder_id = args.get("folderId").or_else(|| args.get("folder_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            ews::ews_delete_folder(token, anchor, folder_id).await?;
            Ok(Value::Null)
        }
        #[cfg(feature = "graph")]
        "msgraph_get_profile" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let res = msgraph::msgraph_get_profile(token).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_list_folders" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let res = msgraph::msgraph_list_folders(token).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_sync_page" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let link = args.get("link").and_then(|v| v.as_str()).map(String::from);
            let received_after = args.get("receivedAfter").or_else(|| args.get("received_after")).and_then(|v| v.as_str()).map(String::from);
            let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as u32);
            let res = msgraph::msgraph_sync_page(token, link, received_after, limit).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_get_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_get_message(token, message_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_get_raw" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_get_raw(token, message_id).await?;
            Ok(json!(res))
        }
        #[cfg(feature = "graph")]
        "msgraph_get_attachment" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let attachment_id = args.get("attachmentId").or_else(|| args.get("attachment_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_get_attachment(token, message_id, attachment_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_move_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let destination = args["destination"].as_str().unwrap_or("").to_string();
            let res = msgraph::msgraph_move_message(token, message_id, destination).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_update_flags" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let is_read = args.get("isRead").or_else(|| args.get("is_read")).and_then(|v| v.as_bool());
            let flagged = args.get("flagged").and_then(|v| v.as_bool());
            msgraph::msgraph_update_flags(token, message_id, is_read, flagged).await?;
            Ok(Value::Null)
        }
        #[cfg(feature = "graph")]
        "msgraph_delete_message" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            msgraph::msgraph_delete_message(token, message_id).await?;
            Ok(Value::Null)
        }
        #[cfg(feature = "graph")]
        "msgraph_send_mime" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let raw_base64_url = args.get("rawBase64Url").or_else(|| args.get("raw_base64_url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_send_mime(token, raw_base64_url).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_create_draft_mime" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let raw_base64_url = args.get("rawBase64Url").or_else(|| args.get("raw_base64_url")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_create_draft_mime(token, raw_base64_url).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_send_draft" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let message_id = args.get("messageId").or_else(|| args.get("message_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let res = msgraph::msgraph_send_draft(token, message_id).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_create_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let name = args["name"].as_str().unwrap_or("").to_string();
            let res = msgraph::msgraph_create_folder(token, name).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_rename_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let folder_id = args.get("folderId").or_else(|| args.get("folder_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = args["name"].as_str().unwrap_or("").to_string();
            let res = msgraph::msgraph_rename_folder(token, folder_id, name).await?;
            serde_json::to_value(res).map_err(|e| e.to_string())
        }
        #[cfg(feature = "graph")]
        "msgraph_delete_folder" => {
            let token = args["token"].as_str().unwrap_or("").to_string();
            let folder_id = args.get("folderId").or_else(|| args.get("folder_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            msgraph::msgraph_delete_folder(token, folder_id).await?;
            Ok(Value::Null)
        }
        "close_splashscreen" | "set_tray_tooltip" | "open_devtools" | "check_for_updates" | "install_update" => {
            // Handled directly in Electron main process; safe no-op if invoked here
            Ok(Value::Null)
        }
        other => Err(format!("Command '{other}' not implemented in Rust core")),
    }
}
