//! Exchange Web Services for Office 365 mailboxes.
//! The mailbox endpoint is the one Evolution documents for Microsoft 365.
//! Sign-in stays in the OAuth device-code commands; these calls only use the token.

use std::collections::HashMap;
use std::time::Duration;

pub mod calendar;

use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::graph_types::{
    GraphAttachmentDto, GraphFolderDto, GraphHeader, GraphMessageDto, GraphMoveResult, GraphParty,
};

const EWS_URL: &str = "https://outlook.office365.com/EWS/Exchange.asmx";
const SOAP_NS: &str = "http://schemas.microsoft.com/exchange/services/2006/messages";
const PAGE_CHANGES: usize = 512;
const FOLDER_CAP: usize = 500;

const DISTINGUISHED: &[&str] = &[
    "inbox",
    "sentitems",
    "drafts",
    "deleteditems",
    "junkemail",
    "archive",
    "outbox",
];

#[derive(Debug)]
struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<Node>,
}

impl Node {
    fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|child| child.name == name)
    }

    fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |child| child.name == name)
    }

    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    fn find(&self, name: &str) -> Option<&Node> {
        if self.name == name {
            return Some(self);
        }
        for child in &self.children {
            if let Some(found) = child.find(name) {
                return Some(found);
            }
        }
        None
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FolderCursor {
    id: String,
    sync: Option<String>,
    done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Checkpoint {
    after: String,
    pending: Vec<String>,
    #[serde(rename = "pendingFolder")]
    pending_folder: Option<String>,
    #[serde(rename = "nextSync")]
    next_sync: Option<String>,
    #[serde(rename = "includesLast")]
    includes_last: bool,
    folders: Vec<FolderCursor>,
}

impl Default for Checkpoint {
    fn default() -> Self {
        Self {
            after: String::new(),
            pending: Vec::new(),
            pending_folder: None,
            next_sync: None,
            includes_last: false,
            folders: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct MailFolder {
    id: String,
    name: String,
    well_known: Option<String>,
    unread: u64,
    total: u64,
}

#[derive(Clone, Debug)]
struct Change {
    kind: &'static str,
    id: String,
    received_ms: Option<i64>,
    class: String,
    element: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsSyncPage {
    pub messages: Vec<GraphMessageDto>,
    pub removed_ids: Vec<String>,
    pub checkpoint: String,
    pub caught_up: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsId {
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsDraft {
    pub draft_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EwsAttachment {
    pub data: String,
    pub size: usize,
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn envelope(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="{SOAP_NS}">
  <soap:Header><t:RequestServerVersion Version="Exchange2016"/></soap:Header>
  <soap:Body>{body}</soap:Body>
</soap:Envelope>"#
    )
}

fn local_name(name: &[u8]) -> String {
    let raw = String::from_utf8_lossy(name);
    raw.rsplit(':').next().unwrap_or("").to_string()
}

fn parse_xml(input: &str) -> Result<Node, String> {
    let mut reader = Reader::from_str(input);
    let mut text = String::new();
    let mut stack = vec![Node {
        name: String::new(),
        attrs: Vec::new(),
        text: String::new(),
        children: Vec::new(),
    }];
    loop {
        let event = reader.read_event().map_err(|err| format!("Could not read the Exchange response: {err}"))?;
        // References arrive as separate events. Join them before trimming so
        // text such as `Sales &amp; Support` retains its internal spaces.
        if !matches!(event, Event::Text(_) | Event::GeneralRef(_)) && !text.is_empty() {
            let decoded = quick_xml::escape::unescape(text.trim_matches([' ', '\t', '\r', '\n']))
                .map_err(|_| "Exchange response had unreadable text.".to_string())?;
            if let Some(top) = stack.last_mut() {
                top.text.push_str(&decoded);
            }
            text.clear();
        }
        match event {
            Event::Start(event) => {
                if stack.len() > 128 {
                    return Err("Exchange response exceeded the XML nesting limit.".to_string());
                }
                stack.push(node_start(&event)?);
            }
            Event::Empty(event) => {
                let node = node_start(&event)?;
                stack
                    .last_mut()
                    .ok_or_else(|| "Exchange response was incomplete.".to_string())?
                    .children
                    .push(node);
            }
            Event::Text(event) => {
                let decoded = event.decode().map_err(|_| "Exchange response had unreadable text.".to_string())?;
                text.push_str(&decoded);
            }
            Event::GeneralRef(reference) => {
                let decoded = reference.decode().map_err(|_| "Exchange response had an unreadable reference.".to_string())?;
                text.push('&');
                text.push_str(&decoded);
                text.push(';');
            }
            Event::CData(event) => {
                let text = String::from_utf8_lossy(event.as_ref());
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&text);
                }
            }
            Event::End(_) => {
                let done = stack
                    .pop()
                    .ok_or_else(|| "Exchange response was incomplete.".to_string())?;
                stack
                    .last_mut()
                    .ok_or_else(|| "Exchange response was incomplete.".to_string())?
                    .children
                    .push(done);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err("Exchange response was incomplete.".to_string());
    }
    stack
        .pop()
        .ok_or_else(|| "Exchange response was empty.".to_string())
}

fn node_start(event: &quick_xml::events::BytesStart<'_>) -> Result<Node, String> {
    let mut attrs = Vec::new();
    for attr in event.attributes() {
        let attr = attr.map_err(|_| "Exchange response had an unreadable attribute.".to_string())?;
        let key = local_name(attr.key.local_name().as_ref());
        let value = attr
            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
            .map_err(|_| "Exchange response had an unreadable attribute.".to_string())?
            .into_owned();
        attrs.push((key, value));
    }
    Ok(Node {
        name: local_name(event.local_name().as_ref()),
        attrs,
        text: String::new(),
        children: Vec::new(),
    })
}

fn assert_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() || token.chars().any(|ch| ch.is_control()) {
        return Err("Sign-in token is missing.".to_string());
    }
    Ok(())
}

fn assert_anchor(anchor: &str) -> Result<String, String> {
    let anchor = anchor.trim();
    if anchor.is_empty()
        || anchor.len() > 320
        || anchor
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | '"' | '&'))
    {
        return Err("Mailbox address is not valid.".to_string());
    }
    Ok(anchor.to_string())
}

fn assert_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 2000 || value.chars().any(|ch| ch.is_control()) {
        return Err(format!("{label} is not valid."));
    }
    Ok(value.to_string())
}

fn assert_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 200 || value.chars().any(|ch| ch.is_control()) {
        return Err("Folder name is not valid.".to_string());
    }
    Ok(value.to_string())
}

fn validate_datetime(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 40 || ews_time_ms(value).is_none() {
        return Err("Invalid received time filter.".to_string());
    }
    Ok(())
}

fn http_error(status: u16, body: &str) -> String {
    let excerpt: String = body.chars().take(300).collect();
    if status == 401 || status == 403 {
        return format!(
            "Exchange Web Services refused the mailbox (HTTP {status}). The organization may have EWS turned off, or this application is not allowed to use it. {excerpt}"
        );
    }
    format!("Exchange returned HTTP {status}: {excerpt}")
}

fn fault_message(root: &Node) -> Option<String> {
    let fault = root.find("Fault")?;
    let text = fault
        .find("faultstring")
        .map(|node| node.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Exchange request failed.".to_string());
    Some(text)
}

fn response_failure(node: &Node) -> Option<String> {
    let code = node.child("ResponseCode")?.text.trim();
    if code.is_empty() || code == "NoError" {
        return None;
    }
    let detail = node
        .child("MessageText")
        .map(|item| item.text.trim().to_string())
        .filter(|text| !text.is_empty());
    let message = match detail {
        Some(text) => format!("{code}: {text}"),
        None => code.to_string(),
    };
    if code == "ErrorInvalidSyncStateData" {
        return Some("EWS_SYNC_RESET".to_string());
    }
    Some(message)
}

async fn ews_call(token: &str, anchor: &str, action: &str, body: String) -> Result<Node, String> {
    assert_token(token)?;
    let anchor = assert_anchor(anchor)?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| err.to_string())?
        .post(EWS_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "text/xml; charset=utf-8")
        .header("SOAPAction", format!("\"{SOAP_NS}/{action}\""))
        .header("X-AnchorMailbox", anchor)
        .body(envelope(&body))
        .send()
        .await
        .map_err(|err| format!("Could not reach Exchange Web Services: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Could not read the Exchange response: {err}"))?;
    if !status.is_success() {
        return Err(http_error(status.as_u16(), &text));
    }
    let root = parse_xml(&text)?;
    if let Some(fault) = fault_message(&root) {
        return Err(fault);
    }
    Ok(root)
}

fn folder_rank(well_known: &Option<String>) -> u8 {
    match well_known.as_deref() {
        Some("inbox") => 0,
        Some("sentitems") => 1,
        Some("drafts") => 2,
        Some("deleteditems") => 3,
        Some("junkemail") => 4,
        Some("archive") => 5,
        _ => 9,
    }
}

fn skip_folder_class(class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    [
        "ipm.appointment",
        "ipm.contact",
        "ipm.task",
        "ipm.stickynote",
        "ipm.activity",
    ]
    .iter()
    .any(|prefix| class.starts_with(prefix))
}

fn parse_folder(node: &Node, well_known: Option<String>) -> Option<MailFolder> {
    let id = node.child("FolderId")?.attr("Id")?.to_string();
    let class = node
        .child("FolderClass")
        .map(|item| item.text.trim().to_string())
        .unwrap_or_default();
    if skip_folder_class(&class) {
        return None;
    }
    if node
        .child("IsHidden")
        .map(|item| item.text.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return None;
    }
    let name = node
        .child("DisplayName")
        .map(|item| item.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Folder".to_string());
    Some(MailFolder {
        id,
        name,
        well_known,
        unread: node
            .child("UnreadCount")
            .and_then(|item| item.text.trim().parse().ok())
            .unwrap_or(0),
        total: node
            .child("TotalCount")
            .and_then(|item| item.text.trim().parse().ok())
            .unwrap_or(0),
    })
}

fn folder_dto(folder: &MailFolder) -> GraphFolderDto {
    GraphFolderDto {
        id: folder.id.clone(),
        display_name: folder.name.clone(),
        parent_folder_id: None,
        well_known_name: folder.well_known.clone(),
        unread_count: folder.unread,
        total_count: folder.total,
    }
}

fn response_messages(root: &Node) -> Vec<&Node> {
    root.find("ResponseMessages")
        .map(|node| node.children.iter().collect())
        .unwrap_or_default()
}

async fn list_mail_folders(token: &str, anchor: &str) -> Result<Vec<MailFolder>, String> {
    let mut folders: HashMap<String, MailFolder> = HashMap::new();
    let ids = DISTINGUISHED
        .iter()
        .map(|name| format!("<t:DistinguishedFolderId Id=\"{name}\"/>"))
        .collect::<String>();
    let distinguished = ews_call(
        token,
        anchor,
        "GetFolder",
        format!(
            "<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"folder:FolderClass\"/></t:AdditionalProperties></m:FolderShape><m:FolderIds>{ids}</m:FolderIds></m:GetFolder>"
        ),
    )
    .await?;
    for (message, name) in response_messages(&distinguished).into_iter().zip(DISTINGUISHED.iter()) {
        if response_failure(message).is_some() {
            continue;
        }
        let Some(folder_node) = message.find("Folder") else {
            continue;
        };
        if let Some(folder) = parse_folder(folder_node, Some((*name).to_string())) {
            folders.insert(folder.id.clone(), folder);
        }
    }

    let mut offset = 0usize;
    for _ in 0..10 {
        if folders.len() >= FOLDER_CAP {
            break;
        }
        let page = ews_call(
            token,
            anchor,
            "FindFolder",
            format!(
                "<m:FindFolder Traversal=\"Deep\"><m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"folder:FolderClass\"/></t:AdditionalProperties></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned=\"100\" Offset=\"{offset}\" BasePoint=\"Beginning\"/><m:ParentFolderIds><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:ParentFolderIds></m:FindFolder>"
            ),
        )
        .await?;
        let Some(message) = response_messages(&page).into_iter().next() else {
            break;
        };
        if let Some(err) = response_failure(message) {
            if folders.is_empty() {
                return Err(err);
            }
            break;
        }
        let Some(root_folder) = message.find("RootFolder") else {
            break;
        };
        let mut count = 0usize;
        if let Some(list) = root_folder.find("Folders") {
            for child in list.children("Folder") {
                count += 1;
                if folders.len() >= FOLDER_CAP {
                    break;
                }
                if let Some(folder) = parse_folder(child, None) {
                    folders.entry(folder.id.clone()).or_insert(folder);
                }
            }
        }
        let last = root_folder
            .attr("IncludesLastItemInRange")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        if last || count == 0 {
            break;
        }
        let next = root_folder
            .attr("IndexedPagingOffset")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(offset + count);
        if next <= offset {
            break;
        }
        offset = next;
    }

    if folders.is_empty() {
        return Err("Exchange did not return the mailbox folders.".to_string());
    }
    let mut listed: Vec<_> = folders.into_values().collect();
    listed.sort_by(|left, right| {
        folder_rank(&left.well_known)
            .cmp(&folder_rank(&right.well_known))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(listed)
}

fn decode_mime(value: &str) -> Result<Vec<u8>, String> {
    let mut translated = value.replace('-', "+").replace('_', "/");
    while translated.len() % 4 != 0 {
        translated.push('=');
    }
    base64::engine::general_purpose::STANDARD
        .decode(translated.trim())
        .map_err(|_| "Could not read the message to send.".to_string())
}

fn encode_mime(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn bool_text(node: &Node, name: &str) -> bool {
    node.child(name)
        .map(|item| item.text.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn snippet_from(body: &str, html: bool) -> String {
    let text = if html { strip_tags(body) } else { body.to_string() };
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(160).collect()
}

fn strip_tags(value: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn party(node: &Node) -> Option<GraphParty> {
    let mailbox = node.child("Mailbox").unwrap_or(node);
    let address = mailbox
        .child("EmailAddress")
        .map(|item| item.text.trim().to_string())
        .filter(|text| !text.is_empty());
    let name = mailbox
        .child("Name")
        .map(|item| item.text.trim().to_string())
        .filter(|text| !text.is_empty());
    if address.is_none() && name.is_none() {
        return None;
    }
    Some(GraphParty { name, address })
}

fn parties(parent: &Node, name: &str) -> Vec<GraphParty> {
    parent
        .child(name)
        .map(|node| node.children.iter().filter_map(party).collect())
        .unwrap_or_default()
}

fn message_inference_classification(node: &Node) -> Option<String> {
    let mut tag_1213: Option<bool> = None;
    let mut inference_result: Option<bool> = None;
    let mut original_inference: Option<bool> = None;

    for prop in node.children("ExtendedProperty") {
        let Some(field_uri) = prop.child("ExtendedFieldURI") else {
            continue;
        };
        let Some(val_str) = prop.child("Value").map(|v| v.text.trim()) else {
            continue;
        };
        let is_focused = if val_str.eq_ignore_ascii_case("focused") || val_str == "0" {
            Some(true)
        } else if val_str.eq_ignore_ascii_case("other") || val_str == "1" {
            Some(false)
        } else {
            None
        };
        let Some(focused) = is_focused else {
            continue;
        };

        if let Some(tag) = field_uri.attr("PropertyTag") {
            if tag.eq_ignore_ascii_case("0x1213") || tag == "4627" {
                tag_1213 = Some(focused);
            }
        }
        if let Some(name) = field_uri.attr("PropertyName") {
            if name.eq_ignore_ascii_case("InferenceClassificationResult") {
                inference_result = Some(focused);
            } else if name.eq_ignore_ascii_case("OriginalInferenceClassification") {
                original_inference = Some(focused);
            }
        }
    }

    if let Some(focused) = tag_1213.or(inference_result).or(original_inference) {
        return Some(if focused { "focused" } else { "other" }.to_string());
    }

    None
}

fn message_from_node(node: &Node, fallback_folder: Option<&str>) -> Option<GraphMessageDto> {
    let id = node.child("ItemId")?.attr("Id")?.to_string();
    let body_node = node.child("Body");
    let body_type = body_node
        .and_then(|item| item.attr("BodyType"))
        .unwrap_or("Text");
    let html = body_type.eq_ignore_ascii_case("html");
    let content = body_node.map(|item| item.text.clone());
    let preview = content
        .as_deref()
        .map(|text| snippet_from(text, html))
        .filter(|text| !text.is_empty());
    let attachments = node
        .child("Attachments")
        .map(|list| {
            list.children
                .iter()
                .filter(|child| child.name == "FileAttachment" || child.name == "ItemAttachment")
                .filter_map(|child| {
                    let id = child.child("AttachmentId")?.attr("Id")?.to_string();
                    Some(GraphAttachmentDto {
                        id,
                        name: child.child("Name").map(|item| item.text.trim().to_string()),
                        content_type: child
                            .child("ContentType")
                            .map(|item| item.text.trim().to_string()),
                        size: child
                            .child("Size")
                            .and_then(|item| item.text.trim().parse().ok())
                            .unwrap_or(0),
                        is_inline: bool_text(child, "IsInline"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut headers = Vec::new();
    if let Some(value) = node.child("InReplyTo").map(|item| item.text.trim().to_string()) {
        if !value.is_empty() {
            headers.push(GraphHeader {
                name: "In-Reply-To".to_string(),
                value,
            });
        }
    }
    if let Some(value) = node.child("References").map(|item| item.text.trim().to_string()) {
        if !value.is_empty() {
            headers.push(GraphHeader {
                name: "References".to_string(),
                value,
            });
        }
    }
    let flag = node
        .child("Flag")
        .and_then(|item| item.child("FlagStatus"))
        .map(|item| item.text.trim().to_ascii_lowercase());
    let parent = node
        .child("ParentFolderId")
        .and_then(|item| item.attr("Id"))
        .map(|value| value.to_string())
        .or_else(|| fallback_folder.map(|value| value.to_string()));
    let conversation = node
        .child("ConversationId")
        .and_then(|item| item.attr("Id"))
        .map(|value| value.to_string());
    Some(GraphMessageDto {
        id,
        subject: node.child("Subject").map(|item| item.text.trim().to_string()),
        body_preview: preview,
        body_content: content.clone(),
        body_content_type: Some(if html { "html" } else { "text" }.to_string()),
        from: node.child("From").and_then(party),
        sender: node.child("Sender").and_then(party),
        to_recipients: parties(node, "ToRecipients"),
        cc_recipients: parties(node, "CcRecipients"),
        bcc_recipients: parties(node, "BccRecipients"),
        reply_to: parties(node, "ReplyTo"),
        received_date_time: node
            .child("DateTimeReceived")
            .map(|item| item.text.trim().to_string()),
        sent_date_time: node
            .child("DateTimeSent")
            .map(|item| item.text.trim().to_string()),
        is_read: bool_text(node, "IsRead"),
        is_draft: bool_text(node, "IsDraft"),
        has_attachments: bool_text(node, "HasAttachments") || !attachments.is_empty(),
        internet_message_id: node
            .child("InternetMessageId")
            .map(|item| item.text.trim().to_string())
            .filter(|text| !text.is_empty()),
        headers,
        importance: node
            .child("Importance")
            .map(|item| item.text.trim().to_ascii_lowercase()),
        flag_status: flag,
        parent_folder_id: parent,
        conversation_id: conversation,
        attachments,
        inference_classification: message_inference_classification(node),
    })
}

fn messages_in(root: &Node, fallback_folder: Option<&str>) -> Vec<GraphMessageDto> {
    response_messages(root)
        .into_iter()
        .filter(|message| response_failure(message).is_none())
        .filter_map(|message| message.find("Message"))
        .filter_map(|message| message_from_node(message, fallback_folder))
        .collect()
}

fn changes_in(root: &Node) -> Vec<Change> {
    let Some(changes) = root.find("Changes") else {
        return Vec::new();
    };
    let mut listed = Vec::new();
    for child in &changes.children {
        if child.name == "Delete" || child.name == "ReadFlagChange" {
            if let Some(id) = child.child("ItemId").and_then(|item| item.attr("Id")) {
                listed.push(Change {
                    kind: if child.name == "Delete" { "delete" } else { "update" },
                    id: id.to_string(),
                    received_ms: None,
                    class: String::new(),
                    element: child.name.clone(),
                });
            }
            continue;
        }
        let Some(item) = child.children.first() else {
            continue;
        };
        let Some(id) = item.child("ItemId").and_then(|node| node.attr("Id")) else {
            continue;
        };
        let received = item
            .child("DateTimeReceived")
            .and_then(|node| ews_time_ms(node.text.trim()));
        listed.push(Change {
            kind: if child.name == "Create" { "create" } else { "update" },
            id: id.to_string(),
            received_ms: received,
            class: item
                .child("ItemClass")
                .map(|node| node.text.trim().to_string())
                .unwrap_or_default(),
            element: item.name.clone(),
        });
    }
    listed
}

fn keep_change(change: &Change, after_ms: i64) -> bool {
    if change.kind == "delete" {
        return false;
    }
    if change.element != "Message" && change.element != "PostItem" && change.element != "ReadFlagChange" {
        return false;
    }
    let class = change.class.to_ascii_lowercase();
    if class.starts_with("ipm.schedule")
        || class.starts_with("ipm.appointment")
        || class.starts_with("ipm.contact")
        || class.starts_with("ipm.task")
    {
        return false;
    }
    match change.received_ms {
        Some(ms) if change.kind == "create" && ms < after_ms => false,
        _ => true,
    }
}

fn plan_fetches(changes: &[Change], after_ms: i64, limit: usize) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut fetch = Vec::new();
    let mut pending = Vec::new();
    let mut removed = Vec::new();
    for change in changes {
        if change.kind == "delete" {
            removed.push(change.id.clone());
            continue;
        }
        if !keep_change(change, after_ms) {
            continue;
        }
        if fetch.len() < limit {
            fetch.push(change.id.clone());
        } else {
            pending.push(change.id.clone());
        }
    }
    (fetch, pending, removed)
}

fn commit_cursor(state: &mut Checkpoint, folder_id: &str, next_sync: &str, includes_last: bool, pending: Vec<String>) {
    if pending.is_empty() {
        if let Some(folder) = state.folders.iter_mut().find(|folder| folder.id == folder_id) {
            folder.sync = Some(next_sync.to_string());
            folder.done = includes_last;
        }
        state.pending.clear();
        state.pending_folder = None;
        state.next_sync = None;
        state.includes_last = false;
        return;
    }
    state.pending = pending;
    state.pending_folder = Some(folder_id.to_string());
    state.next_sync = Some(next_sync.to_string());
    state.includes_last = includes_last;
}

fn caught_up(state: &Checkpoint) -> bool {
    state.pending.is_empty() && state.folders.iter().all(|folder| folder.done)
}

fn load_checkpoint(value: &str) -> Checkpoint {
    let trimmed = value.trim();
    if !trimmed.starts_with('{') {
        return Checkpoint::default();
    }
    serde_json::from_str(trimmed).unwrap_or_default()
}

fn item_shape() -> &'static str {
    r#"<m:ItemShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:ConversationId"/><t:FieldURI FieldURI="item:Flag"/><t:FieldURI FieldURI="message:InternetMessageId"/><t:FieldURI FieldURI="item:InReplyTo"/><t:FieldURI FieldURI="message:References"/><t:FieldURI FieldURI="item:Importance"/><t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/><t:ExtendedFieldURI PropertySetId="23239608-685d-4732-9c55-4c95cb4e8e33" PropertyName="InferenceClassificationResult" PropertyType="Integer"/><t:ExtendedFieldURI PropertySetId="23239608-685d-4732-9c55-4c95cb4e8e33" PropertyName="OriginalInferenceClassification" PropertyType="Integer"/></t:AdditionalProperties></m:ItemShape>"#
}

async fn get_items(
    token: &str,
    anchor: &str,
    ids: &[String],
    fallback_folder: Option<&str>,
) -> Result<Vec<GraphMessageDto>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let refs = ids
        .iter()
        .map(|id| format!("<t:ItemId Id=\"{}\"/>", xml_escape(id)))
        .collect::<String>();
    let root = ews_call(
        token,
        anchor,
        "GetItem",
        format!("<m:GetItem>{}<m:ItemIds>{refs}</m:ItemIds></m:GetItem>", item_shape()),
    )
    .await?;
    Ok(messages_in(&root, fallback_folder))
}

fn folder_target(destination: &str) -> String {
    let escaped = xml_escape(destination);
    if DISTINGUISHED.contains(&destination) {
        format!("<t:DistinguishedFolderId Id=\"{escaped}\"/>")
    } else {
        format!("<t:FolderId Id=\"{escaped}\"/>")
    }
}

fn first_moved_id(root: &Node) -> Option<(String, Option<String>)> {
    let item = root.find("ItemId")?;
    let id = item.attr("Id")?.to_string();
    let parent = root
        .find("ParentFolderId")
        .and_then(|node| node.attr("Id"))
        .map(|value| value.to_string());
    Some((id, parent))
}

fn ews_time_ms(value: &str) -> Option<i64> {
    let value = value.trim();
    if value.len() < 19 {
        return None;
    }
    let year: i32 = value.get(0..4)?.parse().ok()?;
    if value.as_bytes().get(4) != Some(&b'-') || value.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let month: u32 = value.get(5..7)?.parse().ok()?;
    let day: u32 = value.get(8..10)?.parse().ok()?;
    let separator = *value.as_bytes().get(10)?;
    if separator != b'T' && separator != b't' && separator != b' ' {
        return None;
    }
    if value.as_bytes().get(13) != Some(&b':') || value.as_bytes().get(16) != Some(&b':') {
        return None;
    }
    let hour: u32 = value.get(11..13)?.parse().ok()?;
    let minute: u32 = value.get(14..16)?.parse().ok()?;
    let second: u32 = value.get(17..19)?.parse().ok()?;
    let mut rest = value.get(19..).unwrap_or("");
    if rest.starts_with('.') {
        let digits = rest.chars().skip(1).take_while(|ch| ch.is_ascii_digit()).count();
        rest = rest.get(1 + digits..).unwrap_or("");
    }
    let offset = if rest.eq_ignore_ascii_case("Z") || rest.is_empty() {
        0
    } else if rest.len() >= 6 && (rest.starts_with('+') || rest.starts_with('-')) {
        let sign = if rest.starts_with('-') { -1 } else { 1 };
        let hours: i64 = rest.get(1..3)?.parse().ok()?;
        let minutes: i64 = rest.get(4..6)?.parse().ok()?;
        sign * (hours * 3600 + minutes * 60)
    } else {
        return None;
    };
    civil_unix_ms(year, month, day, hour, minute, second, offset)
}

fn civil_unix_ms(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    offset_secs: i64,
) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u32;
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * month_prime + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era as i64 * 146097 + doe as i64 - 719468;
    let secs = days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64 - offset_secs;
    secs.checked_mul(1000)
}

fn merge_folders(listed: &[MailFolder], previous: &[FolderCursor]) -> Vec<FolderCursor> {
    let prev: HashMap<&str, &FolderCursor> = previous.iter().map(|folder| (folder.id.as_str(), folder)).collect();
    listed
        .iter()
        .map(|folder| {
            if let Some(old) = prev.get(folder.id.as_str()) {
                (*old).clone()
            } else {
                FolderCursor {
                    id: folder.id.clone(),
                    sync: None,
                    done: false,
                }
            }
        })
        .collect()
}

async fn sync_once(
    token: &str,
    anchor: &str,
    checkpoint: &str,
    received_after: Option<&str>,
    limit: usize,
) -> Result<EwsSyncPage, String> {
    let limit = limit.clamp(1, 100);
    let mut state = load_checkpoint(checkpoint);
    if let Some(after) = received_after.map(str::trim).filter(|value| !value.is_empty()) {
        if state.after.is_empty() {
            validate_datetime(after)?;
            state.after = after.to_string();
        }
    }
    let after_ms = if state.after.is_empty() {
        0
    } else {
        ews_time_ms(&state.after).ok_or_else(|| "Invalid received time filter.".to_string())?
    };

    let reset = !state.folders.is_empty()
        && state.pending.is_empty()
        && state.folders.iter().all(|folder| folder.done);
    if state.folders.is_empty() || reset {
        let listed = list_mail_folders(token, anchor).await?;
        state.folders = merge_folders(&listed, &state.folders);
        if reset {
            for folder in &mut state.folders {
                folder.done = false;
            }
        }
    }

    if !state.pending.is_empty() {
        let folder_id = state.pending_folder.clone().unwrap_or_default();
        let take = limit.min(state.pending.len());
        let fetch: Vec<String> = state.pending.drain(..take).collect();
        let messages = get_items(token, anchor, &fetch, Some(&folder_id)).await?;
        if state.pending.is_empty() {
            if let Some(next_sync) = state.next_sync.clone() {
                let includes_last = state.includes_last;
                commit_cursor(&mut state, &folder_id, &next_sync, includes_last, Vec::new());
            }
        }
        let checkpoint = serde_json::to_string(&state).map_err(|err| err.to_string())?;
        let done = caught_up(&state);
        return Ok(EwsSyncPage {
            messages,
            removed_ids: Vec::new(),
            checkpoint,
            caught_up: done,
        });
    }

    let Some(folder_id) = state
        .folders
        .iter()
        .find(|folder| !folder.done)
        .map(|folder| folder.id.clone())
    else {
        let checkpoint = serde_json::to_string(&state).map_err(|err| err.to_string())?;
        return Ok(EwsSyncPage {
            messages: Vec::new(),
            removed_ids: Vec::new(),
            checkpoint,
            caught_up: true,
        });
    };
    let sync_state = state
        .folders
        .iter()
        .find(|folder| folder.id == folder_id)
        .and_then(|folder| folder.sync.clone());
    let sync_xml = sync_state
        .as_deref()
        .map(|value| format!("<m:SyncState>{}</m:SyncState>", xml_escape(value)))
        .unwrap_or_default();
    let root = ews_call(
        token,
        anchor,
        "SyncFolderItems",
        format!(
            "<m:SyncFolderItems><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI=\"item:DateTimeReceived\"/><t:FieldURI FieldURI=\"item:ItemClass\"/></t:AdditionalProperties></m:ItemShape><m:SyncFolderId><t:FolderId Id=\"{}\"/></m:SyncFolderId>{sync_xml}<m:MaxChangesReturned>{PAGE_CHANGES}</m:MaxChangesReturned></m:SyncFolderItems>",
            xml_escape(&folder_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not return a sync result.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    let next_sync = message
        .child("SyncState")
        .map(|node| node.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Exchange did not return a sync token.".to_string())?;
    let includes_last = message
        .child("IncludesLastItemInRange")
        .map(|node| node.text.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let changes = changes_in(message);
    let (fetch, pending, removed) = plan_fetches(&changes, after_ms, limit);
    let messages = get_items(token, anchor, &fetch, Some(&folder_id)).await?;
    commit_cursor(&mut state, &folder_id, &next_sync, includes_last, pending);
    let checkpoint = serde_json::to_string(&state).map_err(|err| err.to_string())?;
    let done = caught_up(&state);
    Ok(EwsSyncPage {
        messages,
        removed_ids: removed,
        checkpoint,
        caught_up: done,
    })
}

pub async fn ews_ping(token: String, anchor: String) -> Result<(), String> {
    let root = ews_call(
        &token,
        &anchor,
        "GetFolder",
        "<m:GetFolder><m:FolderShape><t:BaseShape>IdOnly</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id=\"inbox\"/></m:FolderIds></m:GetFolder>".to_string(),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not return the inbox.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(())
}

pub async fn ews_list_folders(token: String, anchor: String) -> Result<Vec<GraphFolderDto>, String> {
    let folders = list_mail_folders(&token, &anchor).await?;
    Ok(folders.iter().map(folder_dto).collect())
}

pub async fn ews_sync_page(
    token: String,
    anchor: String,
    checkpoint: String,
    received_after: Option<String>,
    limit: u32,
) -> Result<EwsSyncPage, String> {
    sync_once(
        &token,
        &anchor,
        &checkpoint,
        received_after.as_deref(),
        limit as usize,
    )
    .await
}

pub async fn ews_get_message(
    token: String,
    anchor: String,
    message_id: String,
) -> Result<GraphMessageDto, String> {
    let message_id = assert_id(&message_id, "Message")?;
    let messages = get_items(&token, &anchor, &[message_id], None).await?;
    messages
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not return that message.".to_string())
}

pub async fn ews_get_raw(token: String, anchor: String, message_id: String) -> Result<String, String> {
    let message_id = assert_id(&message_id, "Message")?;
    let root = ews_call(
        &token,
        &anchor,
        "GetItem",
        format!(
            "<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:IncludeMimeContent>true</t:IncludeMimeContent></m:ItemShape><m:ItemIds><t:ItemId Id=\"{}\"/></m:ItemIds></m:GetItem>",
            xml_escape(&message_id)
        ),
    )
    .await?;
    let encoded = root
        .find("MimeContent")
        .map(|node| node.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Exchange did not return the message source.".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Exchange returned an unreadable message source.".to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn ews_get_attachment(
    token: String,
    anchor: String,
    attachment_id: String,
) -> Result<EwsAttachment, String> {
    let attachment_id = assert_id(&attachment_id, "Attachment")?;
    let root = ews_call(
        &token,
        &anchor,
        "GetAttachment",
        format!(
            "<m:GetAttachment><m:AttachmentIds><t:AttachmentId Id=\"{}\"/></m:AttachmentIds></m:GetAttachment>",
            xml_escape(&attachment_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not return the attachment.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    let encoded = message
        .find("Content")
        .map(|node| node.text.trim().to_string())
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "Exchange did not return the attachment.".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&encoded)
        .map_err(|_| "Exchange returned an unreadable attachment.".to_string())?;
    let size = bytes.len();
    Ok(EwsAttachment {
        data: encode_mime(&bytes),
        size,
    })
}

pub async fn ews_move_message(
    token: String,
    anchor: String,
    message_id: String,
    destination: String,
) -> Result<GraphMoveResult, String> {
    let message_id = assert_id(&message_id, "Message")?;
    let destination = assert_id(&destination, "Folder")?;
    let root = ews_call(
        &token,
        &anchor,
        "MoveItem",
        format!(
            "<m:MoveItem><m:ToFolderId>{}</m:ToFolderId><m:ItemIds><t:ItemId Id=\"{}\"/></m:ItemIds></m:MoveItem>",
            folder_target(&destination),
            xml_escape(&message_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not move the message.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    let (id, parent) = first_moved_id(message).unwrap_or((message_id, None));
    let parent_folder_id = parent.or_else(|| {
        if DISTINGUISHED.contains(&destination.as_str()) {
            None
        } else {
            Some(destination)
        }
    });
    Ok(GraphMoveResult { id, parent_folder_id })
}

pub async fn ews_update_flags(
    token: String,
    anchor: String,
    message_id: String,
    is_read: Option<bool>,
    flagged: Option<bool>,
) -> Result<(), String> {
    let message_id = assert_id(&message_id, "Message")?;
    let mut updates = String::new();
    if let Some(read) = is_read {
        updates.push_str(&format!(
            "<t:SetItemField><t:FieldURI FieldURI=\"message:IsRead\"/><t:Message><t:IsRead>{}</t:IsRead></t:Message></t:SetItemField>",
            if read { "true" } else { "false" }
        ));
    }
    if let Some(flagged) = flagged {
        let status = if flagged { "Flagged" } else { "NotFlagged" };
        updates.push_str(&format!(
            "<t:SetItemField><t:FieldURI FieldURI=\"item:Flag\"/><t:Message><t:Flag><t:FlagStatus>{status}</t:FlagStatus></t:Flag></t:Message></t:SetItemField>"
        ));
    }
    if updates.is_empty() {
        return Ok(());
    }
    let root = ews_call(
        &token,
        &anchor,
        "UpdateItem",
        format!(
            "<m:UpdateItem ConflictResolution=\"AlwaysOverwrite\" MessageDisposition=\"SaveOnly\"><m:ItemChanges><t:ItemChange><t:ItemId Id=\"{}\"/><t:Updates>{updates}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>",
            xml_escape(&message_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not update the message.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(())
}

pub async fn ews_set_focused(
    token: String,
    anchor: String,
    message_id: String,
    focused: bool,
) -> Result<(), String> {
    let message_id = assert_id(&message_id, "Message")?;
    let updates = if focused {
        r#"<t:DeleteItemField><t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/></t:DeleteItemField>"#
    } else {
        r#"<t:SetItemField><t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/><t:Message><t:ExtendedProperty><t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/><t:Value>1</t:Value></t:ExtendedProperty></t:Message></t:SetItemField>"#
    };
    let root = ews_call(
        &token,
        &anchor,
        "UpdateItem",
        format!(
            "<m:UpdateItem ConflictResolution=\"AlwaysOverwrite\" MessageDisposition=\"SaveOnly\"><m:ItemChanges><t:ItemChange><t:ItemId Id=\"{}\"/><t:Updates>{updates}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>",
            xml_escape(&message_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not update the message.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(())
}

pub async fn ews_delete_message(token: String, anchor: String, message_id: String) -> Result<(), String> {
    let message_id = assert_id(&message_id, "Message")?;
    let root = ews_call(
        &token,
        &anchor,
        "DeleteItem",
        format!(
            "<m:DeleteItem DeleteType=\"HardDelete\"><m:ItemIds><t:ItemId Id=\"{}\"/></m:ItemIds></m:DeleteItem>",
            xml_escape(&message_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not delete the message.".to_string())?;
    if let Some(err) = response_failure(message) {
        if err.starts_with("ErrorItemNotFound") {
            return Ok(());
        }
        return Err(err);
    }
    Ok(())
}

async fn create_mime(
    token: &str,
    anchor: &str,
    raw_base64_url: &str,
    disposition: &str,
    folder: &str,
) -> Result<Option<String>, String> {
    let bytes = decode_mime(raw_base64_url)?;
    let mime = encode_mime(&bytes);
    let root = ews_call(
        token,
        anchor,
        "CreateItem",
        format!(
            "<m:CreateItem MessageDisposition=\"{disposition}\"><m:SavedItemFolderId><t:DistinguishedFolderId Id=\"{folder}\"/></m:SavedItemFolderId><m:Items><t:Message><t:MimeContent CharacterSet=\"UTF-8\">{mime}</t:MimeContent></t:Message></m:Items></m:CreateItem>"
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not accept the message.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(first_moved_id(message).map(|(id, _)| id))
}

pub async fn ews_send_mime(
    token: String,
    anchor: String,
    raw_base64_url: String,
) -> Result<EwsId, String> {
    let id = create_mime(&token, &anchor, &raw_base64_url, "SendAndSaveCopy", "sentitems").await?;
    Ok(EwsId {
        id: id.unwrap_or_else(synthetic_id),
    })
}

pub async fn ews_create_draft_mime(
    token: String,
    anchor: String,
    raw_base64_url: String,
) -> Result<EwsDraft, String> {
    let id = create_mime(&token, &anchor, &raw_base64_url, "SaveOnly", "drafts")
        .await?
        .ok_or_else(|| "Exchange did not return the draft.".to_string())?;
    Ok(EwsDraft { draft_id: id })
}

pub async fn ews_send_draft(
    token: String,
    anchor: String,
    message_id: String,
) -> Result<EwsId, String> {
    let message_id = assert_id(&message_id, "Draft")?;
    let root = ews_call(
        &token,
        &anchor,
        "SendItem",
        format!(
            "<m:SendItem SaveItemToFolder=\"true\"><m:ItemIds><t:ItemId Id=\"{}\"/></m:ItemIds><m:SavedItemFolderId><t:DistinguishedFolderId Id=\"sentitems\"/></m:SavedItemFolderId></m:SendItem>",
            xml_escape(&message_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not send the draft.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(EwsId {
        id: first_moved_id(message)
            .map(|(id, _)| id)
            .unwrap_or_else(synthetic_id),
    })
}

pub async fn ews_create_folder(
    token: String,
    anchor: String,
    name: String,
) -> Result<GraphFolderDto, String> {
    let name = assert_name(&name)?;
    let root = ews_call(
        &token,
        &anchor,
        "CreateFolder",
        format!(
            "<m:CreateFolder><m:ParentFolderId><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:ParentFolderId><m:Folders><t:Folder><t:DisplayName>{}</t:DisplayName></t:Folder></m:Folders></m:CreateFolder>",
            xml_escape(&name)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not create the folder.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    let folder = message
        .find("Folder")
        .and_then(|node| parse_folder(node, None))
        .ok_or_else(|| "Exchange did not return the new folder.".to_string())?;
    Ok(folder_dto(&folder))
}

pub async fn ews_rename_folder(
    token: String,
    anchor: String,
    folder_id: String,
    name: String,
) -> Result<(), String> {
    let folder_id = assert_id(&folder_id, "Folder")?;
    let name = assert_name(&name)?;
    let root = ews_call(
        &token,
        &anchor,
        "UpdateFolder",
        format!(
            "<m:UpdateFolder><m:FolderChanges><t:FolderChange><t:FolderId Id=\"{}\"/><t:Updates><t:SetFolderField><t:FieldURI FieldURI=\"folder:DisplayName\"/><t:Folder><t:DisplayName>{}</t:DisplayName></t:Folder></t:SetFolderField></t:Updates></t:FolderChange></m:FolderChanges></m:UpdateFolder>",
            xml_escape(&folder_id),
            xml_escape(&name)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not rename the folder.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(())
}

pub async fn ews_delete_folder(token: String, anchor: String, folder_id: String) -> Result<(), String> {
    let folder_id = assert_id(&folder_id, "Folder")?;
    let root = ews_call(
        &token,
        &anchor,
        "DeleteFolder",
        format!(
            "<m:DeleteFolder DeleteType=\"MoveToDeletedItems\"><m:FolderIds><t:FolderId Id=\"{}\"/></m:FolderIds></m:DeleteFolder>",
            xml_escape(&folder_id)
        ),
    )
    .await?;
    let message = response_messages(&root)
        .into_iter()
        .next()
        .ok_or_else(|| "Exchange did not delete the folder.".to_string())?;
    if let Some(err) = response_failure(message) {
        return Err(err);
    }
    Ok(())
}

fn synthetic_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("ews-sent-{millis}")
}

#[cfg(test)]
mod tests {
    use super::{
        changes_in, commit_cursor, ews_time_ms, load_checkpoint, message_from_node, parse_xml,
        plan_fetches, xml_escape, Checkpoint,
    };

    #[test]
    fn epoch_and_offsets_parse() {
        assert_eq!(ews_time_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            ews_time_ms("2026-11-01T12:00:00Z").unwrap() - ews_time_ms("2026-11-01T00:00:00Z").unwrap(),
            12 * 60 * 60 * 1000
        );
        assert_eq!(
            ews_time_ms("2026-11-01T07:00:00-05:00"),
            ews_time_ms("2026-11-01T12:00:00Z")
        );
    }

    #[test]
    fn sync_page_keeps_recent_mail_and_defers_the_rest() {
        let xml = r#"
            <m:SyncFolderItemsResponseMessage>
              <m:ResponseCode>NoError</m:ResponseCode>
              <m:SyncState>STATE&amp;1</m:SyncState>
              <m:IncludesLastItemInRange>false</m:IncludesLastItemInRange>
              <m:Changes>
                <t:Create>
                  <t:Message>
                    <t:ItemId Id="old"/>
                    <t:ItemClass>IPM.Note</t:ItemClass>
                    <t:DateTimeReceived>2020-01-01T00:00:00Z</t:DateTimeReceived>
                  </t:Message>
                </t:Create>
                <t:Create>
                  <t:Message>
                    <t:ItemId Id="new"/>
                    <t:ItemClass>IPM.Note</t:ItemClass>
                    <t:DateTimeReceived>2026-11-01T12:00:00Z</t:DateTimeReceived>
                  </t:Message>
                </t:Create>
                <t:Create>
                  <t:Message>
                    <t:ItemId Id="extra"/>
                    <t:ItemClass>IPM.Note</t:ItemClass>
                    <t:DateTimeReceived>2026-11-02T12:00:00Z</t:DateTimeReceived>
                  </t:Message>
                </t:Create>
                <t:Delete><t:ItemId Id="gone"/></t:Delete>
                <t:Create>
                  <t:CalendarItem>
                    <t:ItemId Id="meeting"/>
                    <t:ItemClass>IPM.Appointment</t:ItemClass>
                  </t:CalendarItem>
                </t:Create>
              </m:Changes>
            </m:SyncFolderItemsResponseMessage>"#;
        let root = parse_xml(xml).unwrap();
        let changes = changes_in(&root);
        let after = ews_time_ms("2026-01-01T00:00:00Z").unwrap();
        let (fetch, pending, removed) = plan_fetches(&changes, after, 1);
        assert_eq!(fetch, vec!["new"]);
        assert_eq!(pending, vec!["extra"]);
        assert_eq!(removed, vec!["gone"]);
        assert_eq!(xml_escape("a&b"), "a&amp;b");
    }

    #[test]
    fn message_xml_becomes_a_mail_record() {
        let xml = r#"
            <t:Message>
              <t:ItemId Id="AAMk"/>
              <t:Subject>Hello</t:Subject>
              <t:Body BodyType="HTML">&lt;p&gt;Hi&lt;/p&gt;</t:Body>
              <t:DateTimeReceived>2026-11-01T12:00:00Z</t:DateTimeReceived>
              <t:IsRead>true</t:IsRead>
              <t:Importance>High</t:Importance>
              <t:From><t:Mailbox><t:Name>Ada</t:Name><t:EmailAddress>ada@example.com</t:EmailAddress></t:Mailbox></t:From>
              <t:ToRecipients><t:Mailbox><t:EmailAddress>bo@example.com</t:EmailAddress></t:Mailbox></t:ToRecipients>
              <t:ConversationId Id="thread-1"/>
              <t:Flag><t:FlagStatus>Flagged</t:FlagStatus></t:Flag>
              <t:InternetMessageId>&lt;m@example.com&gt;</t:InternetMessageId>
              <t:ParentFolderId Id="inbox-id"/>
              <t:HasAttachments>true</t:HasAttachments>
              <t:Attachments>
                <t:FileAttachment>
                  <t:AttachmentId Id="att-1"/>
                  <t:Name>note.txt</t:Name>
                  <t:ContentType>text/plain</t:ContentType>
                  <t:Size>4</t:Size>
                  <t:IsInline>false</t:IsInline>
                </t:FileAttachment>
              </t:Attachments>
            </t:Message>"#;
        let root = parse_xml(xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.id, "AAMk");
        assert_eq!(message.subject.as_deref(), Some("Hello"));
        assert_eq!(message.body_content_type.as_deref(), Some("html"));
        assert_eq!(message.body_content.as_deref(), Some("<p>Hi</p>"));
        assert_eq!(message.from.unwrap().address.as_deref(), Some("ada@example.com"));
        assert_eq!(message.to_recipients[0].address.as_deref(), Some("bo@example.com"));
        assert_eq!(message.conversation_id.as_deref(), Some("thread-1"));
        assert_eq!(message.flag_status.as_deref(), Some("flagged"));
        assert_eq!(message.importance.as_deref(), Some("high"));
        assert!(message.is_read);
        assert_eq!(message.attachments[0].id, "att-1");
        assert_eq!(message.internet_message_id.as_deref(), Some("<m@example.com>"));
        assert_eq!(message.inference_classification, None);
    }

    #[test]
    fn focused_and_other_extended_properties_parsed() {
        let focused_xml = r#"
            <t:Message>
              <t:ItemId Id="msg-focused"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/>
                <t:Value>0</t:Value>
              </t:ExtendedProperty>
            </t:Message>"#;
        let root = parse_xml(focused_xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.inference_classification.as_deref(), Some("focused"));

        let focused_str_xml = r#"
            <t:Message>
              <t:ItemId Id="msg-focused-str"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/>
                <t:Value>Focused</t:Value>
              </t:ExtendedProperty>
            </t:Message>"#;
        let root = parse_xml(focused_str_xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.inference_classification.as_deref(), Some("focused"));

        let other_xml = r#"
            <t:Message>
              <t:ItemId Id="msg-other"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/>
                <t:Value>1</t:Value>
              </t:ExtendedProperty>
            </t:Message>"#;
        let root = parse_xml(other_xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.inference_classification.as_deref(), Some("other"));

        let other_str_xml = r#"
            <t:Message>
              <t:ItemId Id="msg-other-str"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI PropertyTag="0x1213" PropertyType="Integer"/>
                <t:Value>Other</t:Value>
              </t:ExtendedProperty>
            </t:Message>"#;
        let root = parse_xml(other_str_xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.inference_classification.as_deref(), Some("other"));

        let named_focused_xml = r#"
            <t:Message>
              <t:ItemId Id="msg-named"/>
              <t:ExtendedProperty>
                <t:ExtendedFieldURI PropertySetId="23239608-685d-4732-9c55-4c95cb4e8e33" PropertyName="InferenceClassificationResult" PropertyType="Integer"/>
                <t:Value>0</t:Value>
              </t:ExtendedProperty>
            </t:Message>"#;
        let root = parse_xml(named_focused_xml).unwrap();
        let message = message_from_node(root.find("Message").unwrap(), None).unwrap();
        assert_eq!(message.inference_classification.as_deref(), Some("focused"));
    }

    #[test]
    fn pending_fetches_hold_the_sync_token() {
        let mut state = Checkpoint {
            after: "2026-01-01T00:00:00Z".to_string(),
            folders: vec![super::FolderCursor {
                id: "inbox".to_string(),
                sync: None,
                done: false,
            }],
            ..Checkpoint::default()
        };
        commit_cursor(&mut state, "inbox", "NEXT", true, vec!["extra".to_string()]);
        assert!(state.folders[0].sync.is_none());
        assert_eq!(state.next_sync.as_deref(), Some("NEXT"));
        let restored = load_checkpoint(&serde_json::to_string(&state).unwrap());
        assert_eq!(restored.pending, vec!["extra"]);
        let mut done = restored;
        done.pending.clear();
        commit_cursor(&mut done, "inbox", "NEXT", true, Vec::new());
        assert_eq!(done.folders[0].sync.as_deref(), Some("NEXT"));
        assert!(done.folders[0].done);
    }
}
