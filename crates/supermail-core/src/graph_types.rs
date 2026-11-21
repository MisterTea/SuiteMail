use serde::Serialize;

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
