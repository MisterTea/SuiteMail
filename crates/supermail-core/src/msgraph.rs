//! Microsoft Graph mail commands. OAuth stays in `oauth`; this module
//! calls Graph with a bearer token through the blocking `io-msgraph` client.

use std::collections::{HashMap, HashSet, VecDeque};

use base64::Engine;
use io_msgraph::v1::client::{
    MsgraphClientStd, MsgraphClientStdConnectOptions, MsgraphClientStdError,
};
use io_msgraph::v1::rest::users::mail_folders::MsgraphMailFolder;
use io_msgraph::v1::rest::users::mail_folders::list::MsgraphMailFoldersListParams;
use io_msgraph::v1::rest::users::messages::attachments::MsgraphAttachment;
use io_msgraph::v1::rest::users::messages::delta::MsgraphMessagesDeltaParams;
use io_msgraph::v1::rest::users::messages::{
    MsgraphBodyType, MsgraphFlagStatus, MsgraphFollowupFlag, MsgraphImportance, MsgraphMessage,
    MsgraphRecipient,
};
use io_msgraph::v1::field::MsgraphField;
use io_msgraph::v1::page::MsgraphPage;
use serde::Serialize;

const MESSAGE_SELECT: &str = "id,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,isRead,isDraft,hasAttachments,internetMessageId,internetMessageHeaders,importance,flag,parentFolderId,conversationId";
const PAGE_SIZE: u32 = 25;
const FOLDER_CAP: usize = 500;
const ATTACHMENT_CAP: usize = 20;

const WELL_KNOWN: &[&str] = &[
    "inbox",
    "drafts",
    "sentitems",
    "deleteditems",
    "junkemail",
    "archive",
    "outbox",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphProfile {
    pub email: String,
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphFolderDto {
    pub id: String,
    pub display_name: String,
    pub parent_folder_id: Option<String>,
    pub well_known_name: Option<String>,
    pub unread_count: u64,
    pub total_count: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphParty {
    pub name: Option<String>,
    pub address: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphHeader {
    pub name: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAttachmentDto {
    pub id: String,
    pub name: Option<String>,
    pub content_type: Option<String>,
    pub size: i64,
    pub is_inline: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMessageDto {
    pub id: String,
    pub subject: Option<String>,
    pub body_preview: Option<String>,
    pub body_content: Option<String>,
    pub body_content_type: Option<String>,
    pub from: Option<GraphParty>,
    pub sender: Option<GraphParty>,
    pub to_recipients: Vec<GraphParty>,
    pub cc_recipients: Vec<GraphParty>,
    pub bcc_recipients: Vec<GraphParty>,
    pub reply_to: Vec<GraphParty>,
    pub received_date_time: Option<String>,
    pub sent_date_time: Option<String>,
    pub is_read: bool,
    pub is_draft: bool,
    pub has_attachments: bool,
    pub internet_message_id: Option<String>,
    pub headers: Vec<GraphHeader>,
    pub importance: Option<String>,
    pub flag_status: Option<String>,
    pub parent_folder_id: Option<String>,
    pub conversation_id: Option<String>,
    pub attachments: Vec<GraphAttachmentDto>,
    pub inference_classification: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSyncPage {
    pub messages: Vec<GraphMessageDto>,
    pub removed_ids: Vec<String>,
    pub next_link: Option<String>,
    pub delta_link: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphAttachmentData {
    pub data: String,
    pub size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphMoveResult {
    pub id: String,
    pub parent_folder_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphId {
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDraft {
    pub draft_id: String,
}

fn connect(token: &str) -> Result<MsgraphClientStd, String> {
    MsgraphClientStd::connect(token, MsgraphClientStdConnectOptions::default())
        .map_err(map_graph_error)
}

fn map_graph_error(err: MsgraphClientStdError) -> String {
    if let MsgraphClientStdError::Send(send) = &err {
        let text = send.to_string();
        let expired = send.status() == Some(410)
            || text.to_ascii_lowercase().contains("syncstatenotfound");
        if expired {
            return "DELTA_EXPIRED".to_string();
        }
        return text;
    }
    err.to_string()
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|err| format!("Graph task failed: {err}"))?
}

fn validate_datetime(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 40 {
        return Err("Invalid receivedDateTime filter".to_string());
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | ':' | '.' | 'T' | 'Z' | '+'))
    {
        return Err("Invalid receivedDateTime filter".to_string());
    }
    Ok(())
}

fn decode_mime(raw: &str) -> Result<Vec<u8>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Message is empty".to_string());
    }
    let standard: String = trimmed
        .chars()
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    let pad = (4 - standard.len() % 4) % 4;
    let padded = format!("{standard}{}", "=".repeat(pad));
    base64::engine::general_purpose::STANDARD
        .decode(padded)
        .map_err(|err| format!("Could not decode message: {err}"))
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.is_empty())
}

fn party(recipient: MsgraphRecipient) -> Option<GraphParty> {
    let name = nonempty(recipient.email_address.name);
    let address = nonempty(recipient.email_address.address);
    if name.is_none() && address.is_none() {
        None
    } else {
        Some(GraphParty { name, address })
    }
}

fn parties(field: MsgraphField<Vec<MsgraphRecipient>>) -> Vec<GraphParty> {
    field
        .into_option()
        .unwrap_or_default()
        .into_iter()
        .filter_map(party)
        .collect()
}

fn attachment_dto(attachment: MsgraphAttachment) -> GraphAttachmentDto {
    GraphAttachmentDto {
        id: attachment.id,
        name: nonempty(attachment.name),
        content_type: nonempty(attachment.content_type),
        size: attachment.size.unwrap_or(0),
        is_inline: attachment.is_inline.unwrap_or(false),
    }
}

fn message_dto(message: MsgraphMessage, attachments: Vec<GraphAttachmentDto>) -> GraphMessageDto {
    let body_content_type = message.body.as_ref().and_then(|body| {
        body.content_type.map(|kind| match kind {
            MsgraphBodyType::Html => "html".to_string(),
            MsgraphBodyType::Text => "text".to_string(),
        })
    });
    let body_content = message
        .body
        .as_ref()
        .and_then(|body| body.content.clone())
        .filter(|content| !content.is_empty());
    let importance = message.importance.map(|level| {
        match level {
            MsgraphImportance::High => "high",
            MsgraphImportance::Normal => "normal",
            MsgraphImportance::Low => "low",
        }
        .to_string()
    });
    let flag_status = message.flag.and_then(|flag| flag.flag_status).map(|status| {
        match status {
            MsgraphFlagStatus::Flagged => "flagged",
            MsgraphFlagStatus::NotFlagged => "notFlagged",
            MsgraphFlagStatus::Complete => "complete",
        }
        .to_string()
    });
    GraphMessageDto {
        id: message.id,
        subject: nonempty(message.subject),
        body_preview: nonempty(message.body_preview),
        body_content,
        body_content_type,
        from: message.from.and_then(party),
        sender: message.sender.and_then(party),
        to_recipients: parties(message.to_recipients),
        cc_recipients: parties(message.cc_recipients),
        bcc_recipients: parties(message.bcc_recipients),
        reply_to: parties(message.reply_to),
        received_date_time: nonempty(message.received_date_time),
        sent_date_time: nonempty(message.sent_date_time),
        is_read: message.is_read.unwrap_or(false),
        is_draft: message.is_draft.unwrap_or(false),
        has_attachments: message.has_attachments.unwrap_or(false),
        internet_message_id: nonempty(message.internet_message_id),
        headers: message
            .internet_message_headers
            .into_iter()
            .filter(|header| !header.name.is_empty())
            .map(|header| GraphHeader {
                name: header.name,
                value: header.value,
            })
            .collect(),
        importance,
        flag_status,
        parent_folder_id: nonempty(message.parent_folder_id),
        conversation_id: nonempty(message.conversation_id),
        attachments,
        inference_classification: None,
    }
}

fn load_attachments(client: &mut MsgraphClientStd, message: &MsgraphMessage) -> Vec<GraphAttachmentDto> {
    if message.has_attachments != Some(true) || message.id.is_empty() {
        return Vec::new();
    }
    match client.attachments_list(&message.id) {
        Ok(list) => list
            .response
            .value
            .into_iter()
            .take(ATTACHMENT_CAP)
            .map(attachment_dto)
            .collect(),
        Err(err) => {
            log::warn!("Graph attachment list failed for {}: {err}", message.id);
            Vec::new()
        }
    }
}

fn drain_folders(
    client: &mut MsgraphClientStd,
    mut page: MsgraphPage<MsgraphMailFolder>,
) -> Result<Vec<MsgraphMailFolder>, String> {
    let mut all = Vec::new();
    loop {
        all.extend(page.value);
        if all.len() >= FOLDER_CAP {
            break;
        }
        let Some(link) = page.next_link.take() else {
            break;
        };
        page = client
            .page_get::<MsgraphMailFolder>(&link, Some(100))
            .map_err(map_graph_error)?
            .response;
    }
    Ok(all)
}

fn folder_dto(folder: MsgraphMailFolder, known: &HashMap<String, String>) -> GraphFolderDto {
    let id = folder.id.clone();
    GraphFolderDto {
        display_name: if folder.display_name.is_empty() {
            "Folder".to_string()
        } else {
            folder.display_name
        },
        parent_folder_id: folder.parent_folder_id,
        well_known_name: known.get(&id).cloned(),
        unread_count: folder.unread_item_count.unwrap_or(0),
        total_count: folder.total_item_count.unwrap_or(0),
        id,
    }
}

fn consider_folder(
    folder: MsgraphMailFolder,
    known: &HashMap<String, String>,
    seen: &mut HashSet<String>,
    queue: &mut VecDeque<String>,
    out: &mut Vec<GraphFolderDto>,
) {
    if folder.id.is_empty() || !seen.insert(folder.id.clone()) {
        return;
    }
    if folder.child_folder_count.unwrap_or(0) > 0 {
        queue.push_back(folder.id.clone());
    }
    if folder.is_hidden == Some(true) {
        return;
    }
    out.push(folder_dto(folder, known));
}

fn list_folders(client: &mut MsgraphClientStd) -> Result<Vec<GraphFolderDto>, String> {
    let mut known = HashMap::new();
    let mut seeds = Vec::new();
    for name in WELL_KNOWN {
        match client.mail_folder_get(name) {
            Ok(folder) => {
                let folder = folder.response;
                if !folder.id.is_empty() {
                    known.insert(folder.id.clone(), (*name).to_string());
                    seeds.push(folder);
                }
            }
            Err(err) => {
                log::debug!("Graph well-known folder {name} unavailable: {err}");
            }
        }
    }

    let params = MsgraphMailFoldersListParams {
        top: Some(100),
        ..Default::default()
    };
    let root = client
        .mail_folders_list(&params)
        .map_err(map_graph_error)?
        .response;
    let mut folders = drain_folders(client, root)?;
    folders.splice(0..0, seeds);

    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    let mut out = Vec::new();
    for folder in folders {
        if out.len() >= FOLDER_CAP {
            break;
        }
        consider_folder(folder, &known, &mut seen, &mut queue, &mut out);
    }

    while out.len() < FOLDER_CAP {
        let Some(id) = queue.pop_front() else {
            break;
        };
        let page = match client.mail_child_folders_list(&id, &params) {
            Ok(page) => page.response,
            Err(err) => {
                log::warn!("Graph child folders failed for {id}: {err}");
                continue;
            }
        };
        let children = drain_folders(client, page)?;
        for folder in children {
            if out.len() >= FOLDER_CAP {
                break;
            }
            consider_folder(folder, &known, &mut seen, &mut queue, &mut out);
        }
    }
    Ok(out)
}

fn sync_page(
    client: &mut MsgraphClientStd,
    link: Option<String>,
    received_after: Option<String>,
    limit: u32,
) -> Result<GraphSyncPage, String> {
    if link.is_none() {
        if let Some(after) = &received_after {
            validate_datetime(after)?;
        }
    }
    let limit = limit.clamp(1, 100);
    let mut messages = Vec::new();
    let mut removed_ids = Vec::new();
    let mut next_link = None;
    let mut delta_link = None;
    let mut current = link;
    let mut started = false;

    for _ in 0..30 {
        let page = if let Some(existing) = current.as_deref() {
            client
                .messages_delta_from_link_with_page_size(existing, Some(PAGE_SIZE))
                .map_err(map_graph_error)?
                .response
        } else if !started {
            let filter_owned = received_after
                .as_ref()
                .map(|after| format!("receivedDateTime ge {after}"));
            let params = MsgraphMessagesDeltaParams {
                select: Some(MESSAGE_SELECT),
                filter: filter_owned.as_deref(),
                expand: None,
                max_page_size: Some(PAGE_SIZE),
            };
            client
                .messages_delta_with_params(None, &params)
                .map_err(map_graph_error)?
                .response
        } else {
            break;
        };
        started = true;

        for row in page.value {
            if row.removed.is_some() {
                if !row.message.id.is_empty() {
                    removed_ids.push(row.message.id);
                }
                continue;
            }
            if row.message.id.is_empty() {
                continue;
            }
            let attachments = load_attachments(client, &row.message);
            messages.push(message_dto(row.message, attachments));
        }

        if page.delta_link.is_some() {
            delta_link = page.delta_link;
            next_link = None;
            break;
        }
        if messages.len() >= limit as usize || page.next_link.is_none() {
            next_link = page.next_link;
            break;
        }
        current = page.next_link;
    }

    Ok(GraphSyncPage {
        messages,
        removed_ids,
        next_link,
        delta_link,
    })
}

fn get_message(client: &mut MsgraphClientStd, id: &str) -> Result<GraphMessageDto, String> {
    let message = client
        .message_get(id, Some(MESSAGE_SELECT), None)
        .map_err(map_graph_error)?
        .response;
    let attachments = load_attachments(client, &message);
    Ok(message_dto(message, attachments))
}

pub async fn msgraph_get_profile(token: String) -> Result<GraphProfile, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let user = client.me().map_err(map_graph_error)?.response;
        let email = user
            .mail
            .into_iter()
            .chain(user.user_principal_name)
            .find(|value| !value.is_empty())
            .ok_or_else(|| "Microsoft Graph did not return a mailbox address".to_string())?;
        Ok(GraphProfile {
            email,
            name: nonempty(user.display_name),
        })
    })
    .await
}

pub async fn msgraph_list_folders(token: String) -> Result<Vec<GraphFolderDto>, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        list_folders(&mut client)
    })
    .await
}

pub async fn msgraph_sync_page(
    token: String,
    link: Option<String>,
    received_after: Option<String>,
    limit: Option<u32>,
) -> Result<GraphSyncPage, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        sync_page(&mut client, link, received_after, limit.unwrap_or(40))
    })
    .await
}

pub async fn msgraph_get_message(token: String, message_id: String) -> Result<GraphMessageDto, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        get_message(&mut client, &message_id)
    })
    .await
}

pub async fn msgraph_get_raw(token: String, message_id: String) -> Result<String, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let bytes = client
            .message_get_raw(&message_id)
            .map_err(map_graph_error)?
            .response;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
}

pub async fn msgraph_get_attachment(
    token: String,
    message_id: String,
    attachment_id: String,
) -> Result<GraphAttachmentData, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let bytes = client
            .attachment_get_raw(&message_id, &attachment_id)
            .map_err(map_graph_error)?
            .response;
        let size = bytes.len();
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(GraphAttachmentData { data, size })
    })
    .await
}

pub async fn msgraph_move_message(
    token: String,
    message_id: String,
    destination: String,
) -> Result<GraphMoveResult, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let moved = client
            .message_move(&message_id, &destination)
            .map_err(map_graph_error)?
            .response;
        Ok(GraphMoveResult {
            id: if moved.id.is_empty() {
                message_id
            } else {
                moved.id
            },
            parent_folder_id: nonempty(moved.parent_folder_id),
        })
    })
    .await
}

pub async fn msgraph_update_flags(
    token: String,
    message_id: String,
    is_read: Option<bool>,
    flagged: Option<bool>,
) -> Result<(), String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let mut message = MsgraphMessage {
            is_read,
            ..Default::default()
        };
        if let Some(flagged) = flagged {
            message.flag = Some(MsgraphFollowupFlag {
                flag_status: Some(if flagged {
                    MsgraphFlagStatus::Flagged
                } else {
                    MsgraphFlagStatus::NotFlagged
                }),
            });
        }
        client
            .message_update(&message_id, &message)
            .map_err(map_graph_error)?;
        Ok(())
    })
    .await
}

pub async fn msgraph_delete_message(token: String, message_id: String) -> Result<(), String> {
    blocking(move || {
        let mut client = connect(&token)?;
        client
            .message_delete(&message_id)
            .map_err(map_graph_error)?;
        Ok(())
    })
    .await
}

pub async fn msgraph_send_mime(token: String, raw_base64_url: String) -> Result<GraphId, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let raw = decode_mime(&raw_base64_url)?;
        client.mail_send_mime(&raw).map_err(map_graph_error)?;
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        Ok(GraphId {
            id: format!("graph-sent-{millis}"),
        })
    })
    .await
}

pub async fn msgraph_create_draft_mime(
    token: String,
    raw_base64_url: String,
) -> Result<GraphDraft, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let raw = decode_mime(&raw_base64_url)?;
        let created = client
            .message_create_mime(None, &raw)
            .map_err(map_graph_error)?
            .response;
        if created.id.is_empty() {
            return Err("Microsoft Graph did not return a draft id".to_string());
        }
        Ok(GraphDraft {
            draft_id: created.id,
        })
    })
    .await
}

pub async fn msgraph_send_draft(token: String, message_id: String) -> Result<GraphId, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        client
            .message_send(&message_id)
            .map_err(map_graph_error)?;
        Ok(GraphId { id: message_id })
    })
    .await
}

pub async fn msgraph_create_folder(token: String, name: String) -> Result<GraphFolderDto, String> {
    blocking(move || {
        let mut client = connect(&token)?;
        let created = client
            .mail_folder_create(&MsgraphMailFolder {
                display_name: name,
                ..Default::default()
            })
            .map_err(map_graph_error)?
            .response;
        Ok(folder_dto(created, &HashMap::new()))
    })
    .await
}

pub async fn msgraph_rename_folder(
    token: String,
    folder_id: String,
    name: String,
) -> Result<(), String> {
    blocking(move || {
        let mut client = connect(&token)?;
        client
            .mail_folder_update(
                &folder_id,
                &MsgraphMailFolder {
                    display_name: name,
                    ..Default::default()
                },
            )
            .map_err(map_graph_error)?;
        Ok(())
    })
    .await
}

pub async fn msgraph_delete_folder(token: String, folder_id: String) -> Result<(), String> {
    blocking(move || {
        let mut client = connect(&token)?;
        client
            .mail_folder_delete(&folder_id)
            .map_err(map_graph_error)?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{decode_mime, validate_datetime};

    #[test]
    fn decodes_base64url_mime() {
        let bytes = decode_mime("YQ").unwrap();
        assert_eq!(bytes, b"a");
    }

    #[test]
    fn rejects_a_filter_with_spaces() {
        assert!(validate_datetime("2026-01-01T00:00:00Z").is_ok());
        assert!(validate_datetime("2026-01-01T00:00:00Z or 1=1").is_err());
    }
}
