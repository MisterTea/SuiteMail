//! Calendar operations share the mail transport and delegated OAuth session.
use super::*;
use serde_json::{json, Value};

fn checked(root: &Node) -> Result<(), String> {
    let messages = response_messages(root);
    if messages.is_empty() {
        return Err("Exchange returned no calendar response.".into());
    }
    for message in messages {
        if let Some(error) = response_failure(message) {
            return Err(error);
        }
    }
    Ok(())
}

fn text(node: &Node, field: &str) -> Option<String> {
    node.child(field).map(|n| n.text.clone())
}

fn event(node: &Node) -> Result<Value, String> {
    let id = node.child("ItemId").ok_or("Calendar item has no ID.")?;
    let timestamp = |field| {
        text(node, field).and_then(|s| ews_time_ms(&s)).map(|ms| ms / 1000)
            .ok_or_else(|| format!("Calendar item has invalid {field}."))
    };
    let mut attendees = Vec::new();
    for group in ["RequiredAttendees", "OptionalAttendees", "Resources"] {
        if let Some(list) = node.child(group) {
            for attendee in list.children("Attendee") {
                if let Some(mailbox) = attendee.child("Mailbox") {
                    let status = match text(attendee, "ResponseType").as_deref() {
                        Some("Accept") | Some("Organizer") => "accepted",
                        Some("Decline") => "declined",
                        Some("Tentative") => "tentative",
                        _ => "needsAction",
                    };
                    attendees.push(json!({
                        "email": text(mailbox, "EmailAddress"),
                        "displayName": text(mailbox, "Name"),
                        "responseStatus": status,
                    }));
                }
            }
        }
    }
    Ok(json!({
        "remoteEventId": id.attr("Id").ok_or("Calendar item has empty ID.")?,
        "uid": text(node, "UID"),
        "etag": id.attr("ChangeKey"),
        "summary": text(node, "Subject"),
        "description": text(node, "Body"),
        "location": text(node, "Location"),
        "startTime": timestamp("Start")?,
        "endTime": timestamp("End")?,
        "isAllDay": text(node, "IsAllDayEvent").as_deref() == Some("true"),
        "status": if text(node, "IsCancelled").as_deref() == Some("true") { "cancelled" } else { "confirmed" },
        "organizerEmail": node.child("Organizer").and_then(|o| o.child("Mailbox")).and_then(|m| text(m, "EmailAddress")),
        "attendeesJson": serde_json::to_string(&attendees).map_err(|e| e.to_string())?,
        "htmlLink": null, "icalData": null,
    }))
}

fn folder_ref(id: &str) -> Result<String, String> {
    Ok(format!("<t:FolderId Id=\"{}\"/>", xml_escape(&assert_id(id, "Calendar ID")?)))
}

async fn get_events(token: &str, anchor: &str, ids: &[String]) -> Result<Vec<Value>, String> {
    let mut events = Vec::new();
    for batch in ids.chunks(50) {
        let refs = batch.iter().map(|id| format!("<t:ItemId Id=\"{}\"/>", xml_escape(id))).collect::<String>();
        let root = ews_call(token, anchor, "GetItem", format!(
            "<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>Text</t:BodyType></m:ItemShape><m:ItemIds>{refs}</m:ItemIds></m:GetItem>"
        )).await?;
        checked(&root)?;
        for message in response_messages(&root) {
            if let Some(items) = message.find("Items") {
                for item in items.children("CalendarItem") {
                    events.push(event(item)?);
                }
            }
        }
    }
    Ok(events)
}

pub async fn list(token: &str, anchor: &str) -> Result<Value, String> {
    let root = ews_call(token, anchor, "GetFolder", "<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id=\"calendar\"/></m:FolderIds></m:GetFolder>".into()).await?;
    checked(&root)?;
    let primary = root.find("CalendarFolder").ok_or("Exchange returned no default calendar.")?;
    let primary_id = primary.child("FolderId").and_then(|n| n.attr("Id")).ok_or("Calendar has no ID.")?;
    let mut calendars = vec![json!({"remoteId": primary_id, "displayName": text(primary, "DisplayName"), "color": null, "isPrimary": true})];
    for page in 0..100 {
        let offset = page * 100;
        let root = ews_call(token, anchor, "FindFolder", format!(
            "<m:FindFolder Traversal=\"Deep\"><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned=\"100\" Offset=\"{offset}\" BasePoint=\"Beginning\"/><m:ParentFolderIds><t:DistinguishedFolderId Id=\"msgfolderroot\"/></m:ParentFolderIds></m:FindFolder>"
        )).await?;
        checked(&root)?;
        let page_root = root.find("RootFolder").ok_or("Missing calendar folder page.")?;
        if let Some(folders) = page_root.child("Folders") {
            for folder in folders.children("CalendarFolder") {
                let id = folder.child("FolderId").and_then(|n| n.attr("Id")).ok_or("Calendar has no ID.")?;
                if id != primary_id {
                    calendars.push(json!({"remoteId": id, "displayName": text(folder, "DisplayName"), "color": null, "isPrimary": false}));
                }
            }
        }
        if page_root.attr("IncludesLastItemInRange") == Some("true") {
            return Ok(json!(calendars));
        }
    }
    Err("Exchange calendar folder limit exceeded.".into())
}

pub async fn fetch(token: &str, anchor: &str, calendar_id: &str, start: &str, end: &str) -> Result<Value, String> {
    validate_datetime(start)?;
    validate_datetime(end)?;
    if ews_time_ms(start) >= ews_time_ms(end) {
        return Err("Calendar end must be after start.".into());
    }
    let folder = folder_ref(calendar_id)?;
    // CalendarView expands recurring meetings, including modified occurrences.
    let root = ews_call(token, anchor, "FindItem", format!(
        "<m:FindItem Traversal=\"Shallow\"><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:CalendarView MaxEntriesReturned=\"1000\" StartDate=\"{}\" EndDate=\"{}\"/><m:ParentFolderIds>{folder}</m:ParentFolderIds></m:FindItem>",
        xml_escape(start), xml_escape(end)
    )).await?;
    checked(&root)?;
    let page = root.find("RootFolder").ok_or("Missing calendar event page.")?;
    if page.attr("IncludesLastItemInRange") == Some("false") {
        return Err("EWS_CALENDAR_RANGE_FULL: Choose a smaller calendar range.".into());
    }
    let ids = page.child("Items").map(|items| items.children("CalendarItem")
        .filter_map(|item| item.child("ItemId").and_then(|id| id.attr("Id")).map(String::from))
        .collect::<Vec<_>>()).unwrap_or_default();
    Ok(json!(get_events(token, anchor, &ids).await?))
}

// Ordered to match the CalendarItem schema, rather than JSON key order.
fn fields(input: &Value) -> Result<Vec<(&'static str, String)>, String> {
    let mut result = Vec::new();
    for (key, uri, tag) in [
        ("summary", "item:Subject", "Subject"), ("description", "item:Body", "Body"),
        ("startTime", "calendar:Start", "Start"), ("endTime", "calendar:End", "End"),
        ("isAllDay", "calendar:IsAllDayEvent", "IsAllDayEvent"),
        ("location", "calendar:Location", "Location"),
    ] {
        if let Some(value) = input.get(key) {
            let value = if key == "isAllDay" {
                value.as_bool().ok_or("Invalid all-day flag.")?.to_string()
            } else {
                value.as_str().ok_or("Invalid calendar field.")?.to_string()
            };
            if key == "startTime" || key == "endTime" { validate_datetime(&value)?; }
            let attr = if tag == "Body" { " BodyType=\"Text\"" } else { "" };
            result.push((uri, format!("<t:{tag}{attr}>{}</t:{tag}>", xml_escape(&value))));
        }
    }
    if let (Some(start), Some(end)) = (input["startTime"].as_str(), input["endTime"].as_str()) {
        if ews_time_ms(start) >= ews_time_ms(end) { return Err("Calendar end must be after start.".into()); }
    }
    Ok(result)
}

pub async fn save(token: &str, anchor: &str, calendar_id: &str, id: Option<&str>, change_key: Option<&str>, input: &Value) -> Result<Value, String> {
    let fields = fields(input)?;
    let (action, body) = if let Some(id) = id {
        let id = xml_escape(&assert_id(id, "Event ID")?);
        let key = change_key.map(|key| format!(" ChangeKey=\"{}\"", xml_escape(key))).unwrap_or_default();
        let updates = fields.iter().map(|(uri, xml)| format!("<t:SetItemField><t:FieldURI FieldURI=\"{uri}\"/><t:CalendarItem>{xml}</t:CalendarItem></t:SetItemField>")).collect::<String>();
        if updates.is_empty() { return Err("No calendar changes supplied.".into()); }
        ("UpdateItem", format!("<m:UpdateItem ConflictResolution=\"NeverOverwrite\" MessageDisposition=\"SaveOnly\" SendMeetingInvitationsOrCancellations=\"SendToAllAndSaveCopy\"><m:ItemChanges><t:ItemChange><t:ItemId Id=\"{id}\"{key}/><t:Updates>{updates}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"))
    } else {
        for key in ["summary", "startTime", "endTime"] {
            if input[key].as_str().is_none() { return Err(format!("Missing calendar {key}.")); }
        }
        let folder = folder_ref(calendar_id)?;
        let mut xml = fields.into_iter().map(|(_, xml)| xml).collect::<String>();
        if let Some(attendees) = input.get("attendees") {
            let attendees = attendees.as_array().ok_or("Invalid attendees.")?;
            if !attendees.is_empty() {
                xml.push_str("<t:RequiredAttendees>");
                for attendee in attendees {
                    let email = attendee["email"].as_str().ok_or("Invalid attendee email.")?;
                    xml.push_str(&format!("<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>", xml_escape(email)));
                }
                xml.push_str("</t:RequiredAttendees>");
            }
        }
        xml.push_str("<t:StartTimeZone Id=\"UTC\"/><t:EndTimeZone Id=\"UTC\"/>");
        ("CreateItem", format!("<m:CreateItem SendMeetingInvitations=\"SendToAllAndSaveCopy\"><m:SavedItemFolderId>{folder}</m:SavedItemFolderId><m:Items><t:CalendarItem>{xml}</t:CalendarItem></m:Items></m:CreateItem>"))
    };
    let root = ews_call(token, anchor, action, body).await?;
    checked(&root)?;
    let id = root.find("ItemId").and_then(|n| n.attr("Id")).ok_or("Exchange did not return the saved event ID.")?;
    get_events(token, anchor, &[id.into()]).await?.into_iter().next().ok_or("Saved calendar event was not returned.".into())
}

pub async fn delete(token: &str, anchor: &str, id: &str, change_key: Option<&str>) -> Result<(), String> {
    let id = xml_escape(&assert_id(id, "Event ID")?);
    let key = change_key.map(|key| format!(" ChangeKey=\"{}\"", xml_escape(key))).unwrap_or_default();
    let root = ews_call(token, anchor, "DeleteItem", format!(
        "<m:DeleteItem DeleteType=\"MoveToDeletedItems\" SendMeetingCancellations=\"SendToAllAndSaveCopy\" AffectedTaskOccurrences=\"SpecifiedOccurrenceOnly\"><m:ItemIds><t:ItemId Id=\"{id}\"{key}/></m:ItemIds></m:DeleteItem>"
    )).await?;
    checked(&root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_item_maps_occurrence_times_and_attendees() {
        let root = parse_xml(r#"<t:CalendarItem xmlns:t="urn:test">
          <t:ItemId Id="occurrence-id" ChangeKey="version-2"/>
          <t:Subject>A &amp; B</t:Subject><t:Body BodyType="Text">Agenda</t:Body>
          <t:Start>2026-11-22T09:00:00-06:00</t:Start><t:End>2026-11-22T16:00:00Z</t:End>
          <t:UID>series-uid</t:UID><t:IsAllDayEvent>false</t:IsAllDayEvent>
          <t:Organizer><t:Mailbox><t:EmailAddress>organizer@example.com</t:EmailAddress></t:Mailbox></t:Organizer>
          <t:RequiredAttendees><t:Attendee><t:Mailbox><t:EmailAddress>guest@example.com</t:EmailAddress></t:Mailbox><t:ResponseType>Accept</t:ResponseType></t:Attendee></t:RequiredAttendees>
        </t:CalendarItem>"#).unwrap();
        let mapped = event(root.find("CalendarItem").unwrap()).unwrap();
        assert_eq!(mapped["remoteEventId"], "occurrence-id");
        assert_eq!(mapped["etag"], "version-2");
        assert_eq!(mapped["summary"], "A & B");
        assert_eq!(mapped["startTime"], ews_time_ms("2026-11-22T15:00:00Z").unwrap() / 1000);
        let attendees: Value = serde_json::from_str(mapped["attendeesJson"].as_str().unwrap()).unwrap();
        assert_eq!(attendees[0]["responseStatus"], "accepted");
        assert_eq!(mapped["organizerEmail"], "organizer@example.com");
    }

    #[test]
    fn fields_escape_xml_and_preserve_empty_edits() {
        let input = json!({"summary": "A < B & C", "description": "", "isAllDay": false, "location": ""});
        let xml = fields(&input).unwrap().into_iter().map(|(_, xml)| xml).collect::<String>();
        assert!(xml.contains("A &lt; B &amp; C"));
        assert!(xml.contains("<t:Body BodyType=\"Text\"></t:Body>"));
        assert!(xml.contains("<t:IsAllDayEvent>false</t:IsAllDayEvent>"));
        assert!(fields(&json!({"startTime": "bad"})).is_err());
        assert!(fields(&json!({"startTime": "2026-11-23T00:00:00Z", "endTime": "2026-11-22T00:00:00Z"})).is_err());
    }

    #[test]
    fn calendar_faults_are_not_treated_as_empty_success() {
        let root = parse_xml("<ResponseMessages><FindItemResponseMessage><ResponseCode>ErrorAccessDenied</ResponseCode><MessageText>Denied</MessageText></FindItemResponseMessage></ResponseMessages>").unwrap();
        assert_eq!(checked(&root).unwrap_err(), "ErrorAccessDenied: Denied");
        assert!(checked(&parse_xml("<Empty/>").unwrap()).is_err());
    }
}
