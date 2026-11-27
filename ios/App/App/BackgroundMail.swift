import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

@MainActor
final class BackgroundMail {
    static let shared = BackgroundMail()
    static let refreshInterval: TimeInterval = 30 * 60
    private static let cacheFreshnessInterval: TimeInterval = 45 * 60
    private static let notifiedIDsKey = "gmail-notified-message-ids"
    private static let maxNotifiedIDs = 200
    private static let maxIndividualNotifications = 3
    private let identifier = "com.suitemail.app.gmail-refresh"
    private let backfillIdentifier = "com.suitemail.app.gmail-backfill"
    private static let backfillPageSize = 500
    private static let backfillChunkSize = 25
    private static let defaultSyncDays = 365
    private static let backfillBatchURL = URL(string: "https://www.googleapis.com/batch/gmail/v1")!
    private var foreground = false
    private var worker: Task<Void, Never>?
    private var backfillWorker: Task<Void, Never>?
    private var nextBackfillRequest = Date.distantPast

    private final class TaskCompletion {
        private let task: BGTask
        private var completed = false

        init(_ task: BGTask) { self.task = task }

        func finish(_ success: Bool) {
            guard !completed else { return }
            completed = true
            task.expirationHandler = nil
            task.setTaskCompleted(success: success)
        }
    }

    private struct HistoryPage: Codable {
        let request: URL
        let saved: Date
        let data: Data
    }

    func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in self.run(refresh) }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: backfillIdentifier, using: nil) { task in
            guard let processing = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in self.runBackfill(processing) }
        }
    }

    func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Self.refreshInterval)
        try? BGTaskScheduler.shared.submit(request)
        scheduleBackfillIfNeeded()
    }

    func scheduleBackfillIfNeeded() {
        Task { @MainActor in
            let needsBackfill = (try? await self.accountsNeedingBackfill().isEmpty == false) ?? false
            if needsBackfill {
                self.submitBackfillRequest()
            } else {
                BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: self.backfillIdentifier)
            }
        }
    }

    private func submitBackfillRequest() {
        let request = BGProcessingTaskRequest(identifier: backfillIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        try? BGTaskScheduler.shared.submit(request)
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active {
            worker?.cancel()
            backfillWorker?.cancel()
        }
    }

    private func run(_ refresh: BGAppRefreshTask) {
        schedule()
        guard !foreground, worker == nil else { refresh.setTaskCompleted(success: true); return }
        let completion = TaskCompletion(refresh)
        let task = Task {
            let success: Bool
            do {
                try await refreshWork()
                success = !Task.isCancelled
            } catch { success = false }
            worker = nil
            completion.finish(success)
        }
        worker = task
        refresh.expirationHandler = {
            task.cancel()
            Task { @MainActor in completion.finish(false) }
        }
    }

    private func runBackfill(_ processing: BGProcessingTask) {
        guard !foreground, backfillWorker == nil else { processing.setTaskCompleted(success: true); return }
        let completion = TaskCompletion(processing)
        let task = Task {
            var success = true
            var finishedAll = false
            do {
                finishedAll = try await backfillWork(deadline: Date().addingTimeInterval(5 * 60))
                success = !Task.isCancelled
            } catch is CancellationError {
                success = false
            } catch {
                success = false
            }
            backfillWorker = nil
            if !finishedAll && !foreground {
                submitBackfillRequest()
            }
            completion.finish(success)
        }
        backfillWorker = task
        processing.expirationHandler = {
            task.cancel()
            Task { @MainActor in
                if !self.foreground { self.submitBackfillRequest() }
                completion.finish(false)
            }
        }
    }

    /// Everything a background refresh does.
    private func refreshWork() async throws {
        // Scheduled mail first: it is the time-sensitive part of the refresh window.
        _ = await sendDueScheduled()
        try Task.checkCancellation()
        try await fetch()
        try Task.checkCancellation()
        // Chip away at unfinished historical backfill during short refresh windows too.
        _ = try? await backfillWork(deadline: Date().addingTimeInterval(15))
    }

    #if DEBUG
    /// Debug builds only. The simulator can't launch BGAppRefreshTask without attaching a debugger, so
    /// `-SuiteMailDebugRefreshAfterBackground 5,40` runs the same refresh work 5 s and 40 s after the app
    /// enters the background, inside a background-task assertion, while no UI or JS is running.
    func debugRefreshAfterBackground() {
        guard let delays = UserDefaults.standard.string(forKey: "SuiteMailDebugRefreshAfterBackground") else { return }
        var assertion = UIBackgroundTaskIdentifier.invalid
        assertion = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(assertion) }
        Task {
            var elapsed = 0.0
            for delay in delays.split(separator: ",").compactMap({ Double($0) }) {
                try? await Task.sleep(nanoseconds: UInt64(max(0, delay - elapsed) * 1_000_000_000))
                elapsed = delay
                guard !foreground else { break }
                NSLog("SuiteMail debug background refresh at +%.0fs", delay)
                try? await refreshWork()
            }
            UIApplication.shared.endBackgroundTask(assertion)
        }
    }
    #endif

    private func pageFile(_ account: String) throws -> URL {
        guard UUID(uuidString: account) != nil else { throw MailError("Invalid mail account ID.") }
        return try MailStorage.directory("BackgroundMail").appendingPathComponent(account + ".json")
    }

    func take(_ account: String, request: URL) -> Data? {
        guard request.path.hasSuffix("/history"), let file = try? pageFile(account),
              let data = try? Data(contentsOf: file) else { return nil }
        try? FileManager.default.removeItem(at: file)
        guard let entry = try? JSONDecoder().decode(HistoryPage.self, from: data),
              entry.request == request, Date().timeIntervalSince(entry.saved) < Self.cacheFreshnessInterval else { return nil }
        return entry.data
    }

    func discard(_ account: String) throws {
        let file = try pageFile(account)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }

    private func fetch() async throws {
        let accounts: [[String: String]] = try await withCheckedThrowingContinuation { continuation in
            MailCore.database.async {
                do {
                    let rows = try MailCore.call("db_select", [
                        "query": "SELECT id, email, history_id FROM accounts WHERE is_active = 1 AND provider = 'gmail_api' AND history_id IS NOT NULL ORDER BY id"
                    ])
                    continuation.resume(returning: rows as? [[String: String]] ?? [])
                } catch { continuation.resume(throwing: error) }
            }
        }
        guard !accounts.isEmpty else { return }
        let offset = UserDefaults.standard.integer(forKey: "gmail-refresh-offset") % accounts.count
        for index in 0..<min(accounts.count, 3) {
            try Task.checkCancellation()
            let position = (offset + index) % accounts.count
            let account = accounts[position]
            defer { UserDefaults.standard.set((position + 1) % accounts.count, forKey: "gmail-refresh-offset") }
            guard let id = account["id"], let email = account["email"], let cursor = account["history_id"], !cursor.isEmpty,
                  let file = try? pageFile(id) else { continue }
            var url = URLComponents(string: GoogleMail.base + "/history")!
            url.queryItems = [URLQueryItem(name: "startHistoryId", value: cursor)] +
                ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"].map { URLQueryItem(name: "historyTypes", value: $0) }
            do {
                let token = try await GoogleMail.shared.token(email)
                let request = url.url!
                let response = try await GoogleMail.request(request, headers: ["Authorization": "Bearer " + token.value], timeout: 5)
                try Task.checkCancellation()
                guard response.http.statusCode == 200, response.data.count <= 1_000_000,
                      let history = (try JSONSerialization.jsonObject(with: response.data) as? [String: Any])?["history"] as? [Any],
                      !history.isEmpty else { continue }
                // The regular delta sync owns thread downloads, pending-operation checks and the authoritative cursor.
                let page = HistoryPage(request: request, saved: Date(), data: response.data)
                try JSONEncoder().encode(page).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                await notifyNewMessages(accountId: id, accountEmail: email, history: history, token: token.value)
            } catch {
                try Task.checkCancellation()
                // A single revoked or unavailable account must not starve the other accounts.
                continue
            }
        }
    }

    // MARK: - Background notifications

    private struct NotifiableMessage {
        let messageId: String
        let threadId: String
        let fromName: String
        let fromAddress: String
        let subject: String
        let snippet: String
    }

    private static func parseSender(_ fromHeader: String) -> (name: String, address: String) {
        let trimmed = fromHeader.trimmingCharacters(in: .whitespacesAndNewlines)
        if let lt = trimmed.lastIndex(of: "<"), let gt = trimmed.lastIndex(of: ">"), lt < gt {
            let address = trimmed[trimmed.index(after: lt)..<gt].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            var name = trimmed[..<lt].trimmingCharacters(in: .whitespacesAndNewlines)
            if name.hasPrefix("\"") && name.hasSuffix("\"") && name.count >= 2 {
                name = String(name.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            return (name.isEmpty ? (address.isEmpty ? "New mail" : address) : name, address)
        }
        return (trimmed.isEmpty ? "New mail" : trimmed, trimmed.lowercased())
    }

    private static func isWithinQuietHours(start: String, end: String, date: Date = Date()) -> Bool {
        guard !start.isEmpty, !end.isEmpty, start != end else { return false }
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        let now = String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
        return start < end ? (now >= start && now < end) : (now >= start || now < end)
    }

    private func loadNotifiedIDs() -> [String] {
        UserDefaults.standard.stringArray(forKey: Self.notifiedIDsKey) ?? []
    }

    private func saveNotifiedIDs(_ ids: [String]) {
        let trimmed = ids.count > Self.maxNotifiedIDs ? Array(ids.suffix(Self.maxNotifiedIDs)) : ids
        UserDefaults.standard.set(trimmed, forKey: Self.notifiedIDsKey)
    }

    private func canPostNotifications() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    private func shouldNotifyForAccount(accountId: String, fromAddress: String) async -> Bool {
        do {
            let globalRows = try await Self.select("SELECT value FROM settings WHERE key = $1", ["notifications_enabled"])
            if let value = globalRows.first?["value"] as? String, value == "false" { return false }
            let prefRows = try await Self.select("SELECT value FROM settings WHERE key = $1", ["mail_notification_schedule:" + accountId])
            if let raw = prefRows.first?["value"] as? String,
               let data = raw.data(using: .utf8),
               let pref = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let enabled = pref["enabled"] as? Bool, !enabled { return false }
                if let quiet = pref["quiet"] as? Bool, quiet {
                    let start = pref["start"] as? String ?? "18:00"
                    let end = pref["end"] as? String ?? "09:00"
                    if Self.isWithinQuietHours(start: start, end: end) {
                        let vipBypass = pref["vipBypass"] as? Bool ?? true
                        guard vipBypass, !fromAddress.isEmpty else { return false }
                        let vips = try await Self.select(
                            "SELECT 1 FROM notification_vips WHERE account_id = $1 AND LOWER(email) = $2 LIMIT 1",
                            [accountId, fromAddress.lowercased()]
                        )
                        if vips.isEmpty { return false }
                    }
                }
            }
        } catch {
            // Fall through with defaults if settings table is temporarily busy.
        }
        return true
    }

    private func notifyNewMessages(accountId: String, accountEmail: String, history: [Any], token: String) async {
        guard await canPostNotifications() else { return }

        var notifiedList = loadNotifiedIDs()
        var notifiedSet = Set(notifiedList)
        var addedMessageIDs: [String] = []
        var seenInBatch = Set<String>()

        for entry in history {
            guard let item = entry as? [String: Any],
                  let added = item["messagesAdded"] as? [[String: Any]] else { continue }
            for wrapper in added {
                guard let msg = wrapper["message"] as? [String: Any],
                      let msgId = msg["id"] as? String, !msgId.isEmpty else { continue }
                if let labels = msg["labelIds"] as? [String] {
                    if !labels.contains("INBOX") || !labels.contains("UNREAD") { continue }
                    if labels.contains("SENT") || labels.contains("DRAFT") || labels.contains("TRASH") || labels.contains("SPAM") { continue }
                }
                if !notifiedSet.contains(msgId), seenInBatch.insert(msgId).inserted {
                    addedMessageIDs.append(msgId)
                }
            }
        }
        guard !addedMessageIDs.isEmpty else { return }

        // Newest messages first.
        let ordered = Array(addedMessageIDs.reversed())
        if ordered.count > Self.maxIndividualNotifications {
            guard await shouldNotifyForAccount(accountId: accountId, fromAddress: "") else { return }
            let content = UNMutableNotificationContent()
            content.title = accountEmail
            content.body = "\(ordered.count) new emails"
            content.sound = .default
            content.threadIdentifier = "mailbox:\(accountId)"
            content.userInfo = [
                "accountId": accountId,
                "cap_extra": ["accountId": accountId],
            ]
            let request = UNNotificationRequest(identifier: "suitemail-batch-\(accountId)", content: content, trigger: nil)
            try? await UNUserNotificationCenter.current().add(request)
            for id in ordered where notifiedSet.insert(id).inserted { notifiedList.append(id) }
            saveNotifiedIDs(notifiedList)
            return
        }

        var arrivals: [NotifiableMessage] = []
        for msgId in ordered {
            guard !Task.isCancelled else { break }
            guard let encoded = msgId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                  var components = URLComponents(string: GoogleMail.base + "/messages/" + encoded) else { continue }
            components.queryItems = [
                URLQueryItem(name: "format", value: "metadata"),
                URLQueryItem(name: "metadataHeaders", value: "From"),
                URLQueryItem(name: "metadataHeaders", value: "Subject"),
            ]
            guard let url = components.url else { continue }
            do {
                let response = try await GoogleMail.request(url, headers: ["Authorization": "Bearer " + token], timeout: 5)
                guard response.http.statusCode == 200,
                      let json = try JSONSerialization.jsonObject(with: response.data) as? [String: Any] else { continue }
                let labels = json["labelIds"] as? [String] ?? []
                guard labels.contains("INBOX"), labels.contains("UNREAD"),
                      !labels.contains("SENT"), !labels.contains("DRAFT"),
                      !labels.contains("TRASH"), !labels.contains("SPAM") else {
                    if notifiedSet.insert(msgId).inserted { notifiedList.append(msgId) }
                    continue
                }
                let threadId = json["threadId"] as? String ?? msgId
                let payload = json["payload"] as? [String: Any]
                let headers = payload?["headers"] as? [[String: Any]] ?? []
                let fromRaw = headers.first { ($0["name"] as? String)?.caseInsensitiveCompare("From") == .orderedSame }?["value"] as? String ?? ""
                let subjectRaw = headers.first { ($0["name"] as? String)?.caseInsensitiveCompare("Subject") == .orderedSame }?["value"] as? String ?? ""
                let sender = Self.parseSender(fromRaw)
                if sender.address.caseInsensitiveCompare(accountEmail) == .orderedSame {
                    if notifiedSet.insert(msgId).inserted { notifiedList.append(msgId) }
                    continue
                }
                let subject = subjectRaw.trimmingCharacters(in: .whitespacesAndNewlines)
                let snippet = (json["snippet"] as? String ?? "")
                    .components(separatedBy: .whitespacesAndNewlines)
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                arrivals.append(NotifiableMessage(
                    messageId: msgId,
                    threadId: threadId,
                    fromName: sender.name,
                    fromAddress: sender.address,
                    subject: subject.isEmpty ? "(No subject)" : subject,
                    snippet: snippet
                ))
            } catch {
                continue
            }
        }

        for item in arrivals {
            guard await shouldNotifyForAccount(accountId: accountId, fromAddress: item.fromAddress) else { continue }
            let content = UNMutableNotificationContent()
            content.title = item.fromName
            content.subtitle = item.subject
            content.body = item.snippet.isEmpty ? item.subject : item.snippet
            content.sound = .default
            content.threadIdentifier = "mailbox:\(accountId)"
            let extra: [String: String] = [
                "accountId": accountId,
                "threadId": item.threadId,
                "fromAddress": item.fromAddress,
                "subject": item.subject,
            ]
            content.userInfo = [
                "accountId": accountId,
                "threadId": item.threadId,
                "fromAddress": item.fromAddress,
                "subject": item.subject,
                "cap_extra": extra,
            ]
            let request = UNNotificationRequest(identifier: "suitemail-\(accountId)-\(item.messageId)", content: content, trigger: nil)
            try? await UNUserNotificationCenter.current().add(request)
            if notifiedSet.insert(item.messageId).inserted { notifiedList.append(item.messageId) }
        }
        saveNotifiedIDs(notifiedList)
    }

    // MARK: - Scheduled send

    /// The only code that sends scheduled mail on iOS. It runs from the BGAppRefreshTask above (app in the
    /// background) and from the plugin while the app is open, against the app's own database connection.
    ///  - never early: rows are only claimed when ScheduledSendRules.dueSQL holds for the device clock;
    ///  - exactly once: one conditional UPDATE claims a row (pending → sending), the same statement the JS
    ///    uses, and overlapping calls here share one run;
    ///  - a claim left in 'sending' by a killed run is marked failed, never retried, because Gmail may
    ///    already have accepted it.
    struct ScheduledSendResult { var sent = 0; var failed = 0 }
    private var scheduledSends: Task<ScheduledSendResult, Never>?

    func sendDueScheduled() async -> ScheduledSendResult {
        if let running = scheduledSends { return await running.value }
        let task = Task { await self.performScheduledSends() }
        scheduledSends = task
        let result = await task.value
        scheduledSends = nil
        return result
    }

    private enum SendOutcome: Error { case notSent, failed }

    nonisolated private static func database(_ work: @escaping () throws -> Any) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            MailCore.database.async {
                do { continuation.resume(returning: try work()) } catch { continuation.resume(throwing: error) }
            }
        }
    }

    nonisolated private static func select(_ query: String, _ params: [Any]) async throws -> [[String: Any]] {
        try await database { try MailCore.call("db_select", ["query": query, "params": params]) } as? [[String: Any]] ?? []
    }

    nonisolated private static func execute(_ query: String, _ params: [Any]) async throws -> Int {
        let result = try await database { try MailCore.call("db_execute", ["query": query, "params": params]) }
        return ((result as? [String: Any])?["rowsAffected"] as? NSNumber)?.intValue ?? 0
    }

    /// Runs the statements in their own committed transaction. The app's JS shares this SQLite connection and
    /// may have a transaction open (and later roll it back); BEGIN fails then, so a claim or a "sent" mark can
    /// never be undone by someone else's rollback. Returns rows affected per statement.
    nonisolated private static func committed(_ statements: [(String, [Any])]) async throws -> [Int] {
        try await database {
            _ = try MailCore.call("db_execute", ["query": "BEGIN IMMEDIATE", "params": []])
            do {
                var affected: [Int] = []
                for (query, params) in statements {
                    let result = try MailCore.call("db_execute", ["query": query, "params": params])
                    affected.append(((result as? [String: Any])?["rowsAffected"] as? NSNumber)?.intValue ?? 0)
                }
                _ = try MailCore.call("db_execute", ["query": "COMMIT", "params": []])
                return affected
            } catch {
                _ = try? MailCore.call("db_execute", ["query": "ROLLBACK", "params": []])
                throw error
            }
        } as? [Int] ?? []
    }

    private static func int(_ value: Any?) -> Int64? { (value as? NSNumber)?.int64Value }
    private static var now: Int64 { Int64(Date().timeIntervalSince1970) }

    private func performScheduledSends() async -> ScheduledSendResult {
        var result = ScheduledSendResult()
        do {
            let columns = try await Self.select("SELECT name FROM pragma_table_info('scheduled_emails') WHERE name IN ('raw_mime', 'claimed_at')", [])
            guard columns.count == 2 else { return result } // The app hasn't migrated this database yet.
            let now = Self.now
            _ = try await Self.execute("UPDATE scheduled_emails SET status = 'failed' WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < $1)",
                                       [now - ScheduledSendRules.staleSendingSeconds])
            let due = try await Self.select("SELECT id FROM scheduled_emails WHERE status = 'pending' AND raw_mime IS NOT NULL AND "
                                            + ScheduledSendRules.dueSQL("$1") + " ORDER BY scheduled_at ASC", [now])
            for row in due {
                guard let id = row["id"] as? String, !Task.isCancelled else { continue }
                switch await sendOne(id) {
                case .some(true): result.sent += 1
                case .some(false): result.failed += 1
                case .none: break
                }
            }
        } catch {
            NSLog("SuiteMail scheduled send run failed: %@", error.localizedDescription)
        }
        return result
    }

    private func setStatus(_ id: String, _ status: String) async {
        // If this can't be recorded the row stays 'sending' and is later marked failed: never sent twice.
        _ = try? await Self.committed([("UPDATE scheduled_emails SET status = $1 WHERE id = $2 AND status = 'sending'", [status, id])])
    }

    /// true = sent, false = failed, nil = not claimed or put back to pending.
    private func sendOne(_ id: String) async -> Bool? {
        do {
            let now = Self.now
            let claimed = try await Self.committed([("UPDATE scheduled_emails SET status = 'sending', claimed_at = $2 WHERE id = $1 AND status = 'pending' AND "
                                                     + ScheduledSendRules.dueSQL("$2"), [id, now])])
            guard claimed.first == 1 else { return nil } // Not due any more, cancelled, or claimed by someone else.
        } catch { return nil }
        do {
            guard let row = try await Self.select("SELECT s.raw_mime, s.thread_id, s.recurrence_rule, s.scheduled_at, s.created_at, a.email, a.provider "
                    + "FROM scheduled_emails s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.id = $1", [id]).first,
                  let raw = row["raw_mime"] as? String, let scheduledAt = Self.int(row["scheduled_at"]) else { throw SendOutcome.failed }
            // Match the JS sender: a missing account, or one that isn't Gmail, can't send scheduled mail.
            guard let email = row["email"] as? String, row["provider"] as? String == "gmail_api" else { throw SendOutcome.failed }
            let createdAt = Self.int(row["created_at"])
            var body: [String: Any] = ["raw": try ScheduledSendRules.prepareForSend(raw, now: Date(),
                                                                                    unique: UUID().uuidString.replacingOccurrences(of: "-", with: ""))]
            if let thread = row["thread_id"] as? String { body["threadId"] = thread }
            let json = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
            var invalid: String?
            while true {
                let token = try await scheduledSendToken(email, invalid: invalid)
                // Re-check right before the request with a fresh clock reading.
                guard ScheduledSendRules.isDue(scheduledAt: scheduledAt, createdAt: createdAt, now: Self.now) else { throw SendOutcome.notSent }
                let status = try await postScheduled(json, token: token)
                if (200..<300).contains(status) { break }
                if status == 401, invalid == nil { invalid = token; continue } // Nothing was sent; renew once.
                // 401 again, 429 and 503 mean Gmail did not process it; any other error may have been half-processed.
                throw [401, 429, 503].contains(status) ? SendOutcome.notSent : SendOutcome.failed
            }
            let rule = row["recurrence_rule"] as? String
            let next = ScheduledSendRules.isRecurring(rule) ? ScheduledSendRules.nextOccurrence(scheduledAt, rule: rule!) : nil
            var statements: [(String, [Any])] = [("UPDATE scheduled_emails SET status = 'sent' WHERE id = $1 AND status = 'sending'", [id])]
            if let next {
                statements.append(("""
                    INSERT INTO scheduled_emails (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, reply_to_message_id,
                      thread_id, scheduled_at, signature_id, attachment_paths, recurrence_rule, from_address, raw_mime)
                    SELECT $1, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, reply_to_message_id, thread_id, $2,
                      signature_id, attachment_paths, recurrence_rule, from_address, raw_mime FROM scheduled_emails WHERE id = $3
                    """, [UUID().uuidString.lowercased(), next, id]))
            }
            // Gmail has the email now. Record it; if the database stays busy, the row stays 'sending' and is
            // later marked failed rather than sent again.
            for attempt in 0..<20 {
                do { _ = try await Self.committed(statements); break }
                catch { if attempt < 19 { try? await Task.sleep(nanoseconds: 250_000_000) } else { NSLog("SuiteMail could not record scheduled send %@", id) } }
            }
            return true
        } catch SendOutcome.notSent {
            await setStatus(id, "pending") // Gmail never saw it: safe to try again later.
            return nil
        } catch {
            NSLog("SuiteMail scheduled email %@ failed: %@", id, error.localizedDescription)
            await setStatus(id, "failed")
            return false
        }
    }

    /// Reuses the stored Gmail authorization; a failure to get a token means nothing was sent.
    private func scheduledSendToken(_ email: String, invalid: String?) async throws -> String {
        #if DEBUG
        if let token = UserDefaults.standard.string(forKey: "SuiteMailDebugScheduledAccessToken") { return token }
        #endif
        do { return try await GoogleMail.shared.token(email, invalid: invalid).value }
        catch { throw SendOutcome.notSent }
    }

    /// Returns the HTTP status. Throws notSent when the request never left the device, failed when Gmail may have received it.
    nonisolated private func postScheduled(_ json: String, token: String) async throws -> Int {
        let headers = ["Authorization": "Bearer " + token, "Content-Type": "application/json; charset=UTF-8"]
        do {
            #if DEBUG
            if let debug = UserDefaults.standard.string(forKey: "SuiteMailDebugScheduledSendURL"), let url = URL(string: debug) {
                var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
                request.httpMethod = "POST"
                headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
                request.httpBody = Data(json.utf8)
                let (_, response) = try await URLSession.shared.data(for: request)
                return (response as? HTTPURLResponse)?.statusCode ?? 0
            }
            #endif
            return try await GoogleMail.request(URL(string: GoogleMail.base + "/messages/send")!, method: "POST",
                                                headers: headers, body: json, timeout: 30).http.statusCode
        } catch let error as URLError {
            let neverSent: [URLError.Code] = [.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
                                              .internationalRoamingOff, .dataNotAllowed, .secureConnectionFailed, .appTransportSecurityRequiresSecureConnection]
            throw neverSent.contains(error.code) ? SendOutcome.notSent : SendOutcome.failed
        }
    }

    // MARK: - Background historical backfill

    private enum BackfillError: Error {
        case rateLimited
        case http(Int)
    }

    private struct BatchPart {
        let status: Int
        let body: String
    }

    private static func sql(_ value: String?) -> Any {
        value ?? NSNull()
    }

    private func accountsNeedingBackfill() async throws -> [[String: Any]] {
        try await Self.select(
            "SELECT id, email FROM accounts WHERE is_active = 1 AND provider = 'gmail_api' AND (history_id IS NULL OR history_id = '') ORDER BY id",
            []
        )
    }

    private func readSyncPeriodDays() async -> Int {
        if let rows = try? await Self.select("SELECT value FROM settings WHERE key = $1", ["sync_period_days"]),
           let raw = rows.first?["value"] as? String,
           let parsed = Int(raw), parsed > 0 {
            return parsed
        }
        return Self.defaultSyncDays
    }

    private func accountStillNeedsBackfill(_ accountId: String) async throws -> Bool {
        let rows = try await Self.select(
            "SELECT history_id FROM accounts WHERE id = $1 AND is_active = 1 AND provider = 'gmail_api'",
            [accountId]
        )
        guard let row = rows.first else { return false }
        let cursor = row["history_id"] as? String ?? ""
        return cursor.isEmpty
    }

    private func pendingResourceIDs(accountId: String, threadIDs: [String]) async throws -> Set<String> {
        guard !threadIDs.isEmpty else { return [] }
        let placeholders = (0..<threadIDs.count).map { "$\($0 + 2)" }.joined(separator: ",")
        let params: [Any] = [accountId] + threadIDs
        let rows = try await Self.select(
            "SELECT DISTINCT resource_id FROM pending_operations WHERE account_id = $1 AND status = 'pending' AND resource_id IN (\(placeholders))",
            params
        )
        return Set(rows.compactMap { $0["resource_id"] as? String })
    }

    private func checkBackgroundActive() throws {
        try Task.checkCancellation()
        if foreground { throw CancellationError() }
    }

    private func paceBackfill(accountId: String, cost: Int) async throws {
        try checkBackgroundActive()
        let cooldown = Date(timeIntervalSince1970: UserDefaults.standard.double(forKey: "gmail-backfill-cooldown:" + accountId))
        let until = max(nextBackfillRequest, cooldown)
        let wait = until.timeIntervalSinceNow
        if wait > 15 { throw BackfillError.rateLimited }
        if wait > 0 {
            try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            try checkBackgroundActive()
        }
        // 4,500 units/minute (75 units/sec), matching foreground & Android quota budget.
        nextBackfillRequest = Date().addingTimeInterval(Double(cost) * 0.04 / 3.0)
    }

    private static func isRateLimit(status: Int, body: String) -> Bool {
        status == 429 || (status == 403 && (body.contains("rateLimitExceeded")
            || body.contains("userRateLimitExceeded") || body.contains("RATE_LIMIT_EXCEEDED")))
    }

    private func recordBackfillCooldown(accountId: String, http: HTTPURLResponse) {
        var delay: TimeInterval = 60
        if let retry = http.value(forHTTPHeaderField: "Retry-After")?.trimmingCharacters(in: .whitespacesAndNewlines),
           let seconds = TimeInterval(retry) {
            delay = max(delay, seconds)
        }
        UserDefaults.standard.set(Date().addingTimeInterval(delay).timeIntervalSince1970,
                                  forKey: "gmail-backfill-cooldown:" + accountId)
    }

    private func backfillGetJSON(accountId: String, email: String, url: URL, cost: Int,
                                 token: inout String, retried: Bool = false) async throws -> [String: Any] {
        try await paceBackfill(accountId: accountId, cost: cost)
        let response = try await GoogleMail.request(url, headers: ["Authorization": "Bearer " + token], timeout: 20)
        try checkBackgroundActive()
        let status = response.http.statusCode
        if status == 401 && !retried {
            token = try await GoogleMail.shared.token(email, invalid: token).value
            return try await backfillGetJSON(accountId: accountId, email: email, url: url, cost: cost, token: &token, retried: true)
        }
        let text = String(decoding: response.data, as: UTF8.self)
        if Self.isRateLimit(status: status, body: text) {
            recordBackfillCooldown(accountId: accountId, http: response.http)
            throw BackfillError.rateLimited
        }
        guard (200..<300).contains(status),
              let json = try JSONSerialization.jsonObject(with: response.data) as? [String: Any] else {
            throw BackfillError.http(status)
        }
        return json
    }

    private func fetchBackfillBatch(accountId: String, email: String, threadIDs: [String],
                                    token: inout String, retried: Bool = false) async throws -> [String: [String: Any]] {
        try await paceBackfill(accountId: accountId, cost: threadIDs.count * 10)
        let boundary = "suitemail_backfill_" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let body = Self.buildBackfillBatchBody(boundary: boundary, threadIDs: threadIDs)
        let response = try await GoogleMail.request(
            Self.backfillBatchURL,
            method: "POST",
            headers: [
                "Authorization": "Bearer " + token,
                "Content-Type": "multipart/mixed; boundary=" + boundary,
            ],
            body: body,
            timeout: 45
        )
        try checkBackgroundActive()
        let status = response.http.statusCode
        if status == 401 && !retried {
            token = try await GoogleMail.shared.token(email, invalid: token).value
            return try await fetchBackfillBatch(accountId: accountId, email: email, threadIDs: threadIDs, token: &token, retried: true)
        }
        let text = String(decoding: response.data, as: UTF8.self)
        if Self.isRateLimit(status: status, body: text) {
            recordBackfillCooldown(accountId: accountId, http: response.http)
            throw BackfillError.rateLimited
        }
        guard (200..<300).contains(status) else { throw BackfillError.http(status) }

        let contentType = response.http.value(forHTTPHeaderField: "Content-Type") ?? ""
        let parts = Self.parseBackfillBatchResponse(contentType: contentType, text: text)
        var threads: [String: [String: Any]] = [:]
        var sawUnauthorized = false
        for (index, id) in threadIDs.enumerated() {
            guard let part = parts[String(index)] else { throw BackfillError.http(502) }
            if part.status == 404 { continue }
            if part.status == 401 { sawUnauthorized = true; continue }
            if Self.isRateLimit(status: part.status, body: part.body) {
                UserDefaults.standard.set(Date().addingTimeInterval(60).timeIntervalSince1970,
                                          forKey: "gmail-backfill-cooldown:" + accountId)
                throw BackfillError.rateLimited
            }
            guard (200..<300).contains(part.status) else { throw BackfillError.http(part.status) }
            if !part.body.isEmpty,
               let data = part.body.data(using: .utf8),
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                threads[id] = json
            }
        }
        if sawUnauthorized && !retried {
            token = try await GoogleMail.shared.token(email, invalid: token).value
            return try await fetchBackfillBatch(accountId: accountId, email: email, threadIDs: threadIDs, token: &token, retried: true)
        }
        if sawUnauthorized { throw BackfillError.http(401) }
        return threads
    }

    private static func buildBackfillBatchBody(boundary: String, threadIDs: [String]) -> String {
        var result = ""
        for (index, id) in threadIDs.enumerated() {
            let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
            result += "--\(boundary)\r\nContent-Type: application/http\r\nContent-ID: <\(index)>\r\n\r\n"
            result += "GET /gmail/v1/users/me/threads/\(encoded)?format=metadata\r\n\r\n"
        }
        result += "--\(boundary)--\r\n"
        return result
    }

    private static func parseBackfillBatchResponse(contentType: String, text: String) -> [String: BatchPart] {
        var boundary: String?
        if let range = contentType.range(of: "boundary=", options: .caseInsensitive) {
            let tail = contentType[range.upperBound...]
            if tail.hasPrefix("\"") {
                let inner = tail.dropFirst()
                if let end = inner.firstIndex(of: "\"") { boundary = String(inner[..<end]) }
            } else {
                let end = tail.firstIndex(where: { $0 == ";" || $0.isWhitespace }) ?? tail.endIndex
                boundary = String(tail[..<end])
            }
        }
        if boundary == nil, let start = text.range(of: "--") {
            let tail = text[start.upperBound...]
            if let end = tail.firstIndex(of: "\n") {
                boundary = String(tail[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        guard let boundary, !boundary.isEmpty else { return [:] }
        var result: [String: BatchPart] = [:]
        for raw in text.components(separatedBy: "--" + boundary) {
            let part = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\r\n"))
            if part.isEmpty || part.hasPrefix("--") { continue }
            guard let headerSplit = splitHTTPPart(part) else { continue }
            guard let id = extractContentID(headerSplit.headers) else { continue }
            guard let httpSplit = splitHTTPPart(headerSplit.body) else { continue }
            let statusLine = httpSplit.headers.components(separatedBy: .newlines).first ?? ""
            let tokens = statusLine.split(separator: " ")
            guard tokens.count >= 2, let status = Int(tokens[1]) else { continue }
            result[id] = BatchPart(status: status, body: httpSplit.body.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return result
    }

    private static func splitHTTPPart(_ text: String) -> (headers: String, body: String)? {
        if let range = text.range(of: "\r\n\r\n") {
            return (String(text[..<range.lowerBound]), String(text[range.upperBound...]))
        }
        if let range = text.range(of: "\n\n") {
            return (String(text[..<range.lowerBound]), String(text[range.upperBound...]))
        }
        return nil
    }

    private static func extractContentID(_ headers: String) -> String? {
        for line in headers.components(separatedBy: .newlines) {
            guard let range = line.range(of: "Content-ID:", options: .caseInsensitive) else { continue }
            var value = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if value.hasPrefix("<") { value.removeFirst() }
            if value.hasSuffix(">") { value.removeLast() }
            if value.hasPrefix("response-") { value = String(value.dropFirst("response-".count)) }
            if !value.isEmpty { return value }
        }
        return nil
    }

    private static func backfillQuery(daysBack: Int) -> String {
        let after = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let comps = Calendar.current.dateComponents([.year, .month, .day], from: after)
        return "after:\(comps.year ?? 2025)/\(comps.month ?? 1)/\(comps.day ?? 1)"
    }

    private static func parseBackfillCheckpoint(_ raw: String?, daysBack: Int) -> [String: Any]? {
        guard let raw, !raw.isEmpty, let data = raw.data(using: .utf8),
              let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard (saved["version"] as? Int) == 1,
              (saved["daysBack"] as? Int) == daysBack,
              let historyId = saved["historyId"] as? String, !historyId.isEmpty,
              let query = saved["query"] as? String, !query.isEmpty,
              saved["completed"] is Int,
              saved["storedIds"] is [String] else { return nil }
        return saved
    }

    private static func headerValue(_ message: [String: Any], _ name: String) -> String? {
        guard let payload = message["payload"] as? [String: Any],
              let headers = payload["headers"] as? [[String: Any]] else { return nil }
        for h in headers {
            if let key = h["name"] as? String, key.caseInsensitiveCompare(name) == .orderedSame {
                return h["value"] as? String
            }
        }
        return nil
    }

    /// Matches parseEmailAddress in src/services/gmail/messageParser.ts.
    private static func parseEmailAddress(_ raw: String?) -> (name: String?, address: String?) {
        guard let raw else { return (nil, nil) }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (nil, nil) }
        if let lt = trimmed.lastIndex(of: "<"), let gt = trimmed.lastIndex(of: ">"), lt < gt {
            let addr = trimmed[trimmed.index(after: lt)..<gt].trimmingCharacters(in: .whitespacesAndNewlines)
            var name = trimmed[..<lt].trimmingCharacters(in: .whitespacesAndNewlines)
            if name.hasPrefix("\"") && name.hasSuffix("\"") && name.count >= 2 {
                name = String(name.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let address = addr.isEmpty ? nil : addr
            let displayName = (name.isEmpty || name == address) ? nil : name
            return (displayName, address)
        }
        return (nil, trimmed)
    }

    private static func buildThreadStorageStatements(accountId: String, thread: [String: Any]) -> [(String, [Any])] {
        guard let threadId = thread["id"] as? String, !threadId.isEmpty,
              let messages = thread["messages"] as? [[String: Any]], !messages.isEmpty else { return [] }

        var allLabels: [String] = []
        var labelSet = Set<String>()
        var allRead = true
        var anyStarred = false
        var anyAttachments = false
        var firstSubject: String?
        var lastSnippet = ""
        var lastDate: Int64 = 0
        var messageIDs: [String] = []
        var messageUpserts: [(String, [Any])] = []

        for (index, msg) in messages.enumerated() {
            guard let msgId = msg["id"] as? String, !msgId.isEmpty else { continue }
            messageIDs.append(msgId)
            let msgLabels = msg["labelIds"] as? [String] ?? []
            for lid in msgLabels where !lid.isEmpty && labelSet.insert(lid).inserted {
                allLabels.append(lid)
            }
            let isRead = !msgLabels.contains("UNREAD")
            let isStarred = msgLabels.contains("STARRED")
            if !isRead { allRead = false }
            if isStarred { anyStarred = true }

            let payload = msg["payload"] as? [String: Any]
            let hasAtt = (payload?["mimeType"] as? String) == "multipart/mixed"
            if hasAtt { anyAttachments = true }

            let from = parseEmailAddress(headerValue(msg, "From"))
            let subject = headerValue(msg, "Subject")
            let snippet = msg["snippet"] as? String ?? ""
            let internalDate = Int64(msg["internalDate"] as? String ?? "0") ?? 0
            let rawSize = (msg["sizeEstimate"] as? NSNumber)?.intValue ?? 0

            if index == 0 { firstSubject = subject }
            if index == messages.count - 1 {
                lastSnippet = snippet
                lastDate = internalDate
            }

            let msgSQL = """
                INSERT INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, subject, snippet, date, is_read, is_starred, body_html, body_text, body_cached, raw_size, internal_date, list_unsubscribe, list_unsubscribe_post, auth_results, message_id_header, references_header, in_reply_to_header, imap_uid, imap_folder)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL,0,$15,$16,$17,$18,NULL,NULL,NULL,NULL,NULL,NULL)
                ON CONFLICT(account_id, id) DO UPDATE SET
                  from_address=$4, from_name=$5, to_addresses=$6, cc_addresses=$7, bcc_addresses=$8, reply_to=$9,
                  subject=$10, snippet=$11, date=$12, is_read=$13, is_starred=$14, raw_size=$15, internal_date=$16,
                  list_unsubscribe=$17, list_unsubscribe_post=$18
                """
            messageUpserts.append((msgSQL, [
                msgId,
                accountId,
                threadId,
                sql(from.address),
                sql(from.name),
                sql(headerValue(msg, "To")),
                sql(headerValue(msg, "Cc")),
                sql(headerValue(msg, "Bcc")),
                sql(headerValue(msg, "Reply-To")),
                sql(subject),
                snippet,
                internalDate,
                isRead ? 1 : 0,
                isStarred ? 1 : 0,
                rawSize,
                internalDate,
                sql(headerValue(msg, "List-Unsubscribe")),
                sql(headerValue(msg, "List-Unsubscribe-Post")),
            ]))
        }

        guard !messageIDs.isEmpty else { return [] }

        var statements: [(String, [Any])] = []
        let threadSQL = """
            INSERT INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_starred, is_important, has_attachments, is_filtered)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, 0))
            ON CONFLICT(account_id, id) DO UPDATE SET
              subject=$3, snippet=$4, last_message_at=$5, message_count=$6, is_read=$7, is_starred=$8, is_important=$9, has_attachments=$10,
              is_filtered=COALESCE($11, threads.is_filtered)
            """
        statements.append((threadSQL, [
            threadId,
            accountId,
            sql(firstSubject),
            lastSnippet,
            lastDate,
            messageIDs.count,
            allRead ? 1 : 0,
            anyStarred ? 1 : 0,
            labelSet.contains("IMPORTANT") ? 1 : 0,
            anyAttachments ? 1 : 0,
            NSNull(),
        ]))
        statements.append(("DELETE FROM thread_labels WHERE account_id = $1 AND thread_id = $2", [accountId, threadId]))
        for lid in allLabels {
            statements.append(("INSERT OR IGNORE INTO thread_labels (account_id, thread_id, label_id) VALUES ($1, $2, $3)",
                               [accountId, threadId, lid]))
        }
        statements.append(contentsOf: messageUpserts)

        let placeholders = (0..<messageIDs.count).map { "$\($0 + 3)" }.joined(separator: ",")
        let deleteParams: [Any] = [accountId, threadId] + messageIDs
        statements.append(("DELETE FROM messages WHERE account_id = $1 AND thread_id = $2 AND id NOT IN (\(placeholders))", deleteParams))
        return statements
    }

    private func encodeCheckpoint(_ checkpoint: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: checkpoint)
        return String(decoding: data, as: UTF8.self)
    }

    private func backfillAccount(id accountId: String, email: String, daysBack: Int, deadline: Date) async throws -> Bool {
        var token = try await GoogleMail.shared.token(email).value
        let key = "gmail_initial_sync:" + accountId
        let savedRows = try await Self.select("SELECT value FROM settings WHERE key = $1", [key])
        var checkpoint = Self.parseBackfillCheckpoint(savedRows.first?["value"] as? String, daysBack: daysBack) ?? [:]

        if checkpoint.isEmpty {
            let profileURL = URL(string: GoogleMail.base + "/profile?fields=historyId")!
            let profile = try await backfillGetJSON(accountId: accountId, email: email, url: profileURL, cost: 1, token: &token)
            guard let historyId = profile["historyId"] as? String, !historyId.isEmpty else { return false }
            checkpoint = [
                "version": 1,
                "daysBack": daysBack,
                "query": Self.backfillQuery(daysBack: daysBack),
                "historyId": historyId,
                "completed": 0,
                "total": 0,
                "storedIds": [String](),
            ]
            try checkBackgroundActive()
            guard try await accountStillNeedsBackfill(accountId) else { return true }
            _ = try await Self.committed([(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
                [key, try encodeCheckpoint(checkpoint)]
            )])
        }

        while true {
            try checkBackgroundActive()
            if Date() >= deadline { return false }

            let query = checkpoint["query"] as? String ?? Self.backfillQuery(daysBack: daysBack)
            var components = URLComponents(string: GoogleMail.base + "/threads")!
            var items = [
                URLQueryItem(name: "maxResults", value: String(Self.backfillPageSize)),
                URLQueryItem(name: "q", value: query),
            ]
            if let pageToken = checkpoint["pageToken"] as? String, !pageToken.isEmpty {
                items.append(URLQueryItem(name: "pageToken", value: pageToken))
            }
            components.queryItems = items

            let listResponse = try await backfillGetJSON(accountId: accountId, email: email, url: components.url!, cost: 5, token: &token)
            let stubs = listResponse["threads"] as? [[String: Any]] ?? []
            var completed = checkpoint["completed"] as? Int ?? 0
            let estimate = listResponse["resultSizeEstimate"] as? Int ?? 0
            let prevTotal = checkpoint["total"] as? Int ?? 0
            checkpoint["total"] = max(prevTotal, max(completed + stubs.count, estimate))

            var storedIds = checkpoint["storedIds"] as? [String] ?? []
            let storedSet = Set(storedIds)
            let remaining = stubs.compactMap { $0["id"] as? String }.filter { !$0.isEmpty && !storedSet.contains($0) }

            var start = 0
            while start < remaining.count {
                try checkBackgroundActive()
                if Date() >= deadline { return false }
                let end = min(start + Self.backfillChunkSize, remaining.count)
                let chunk = Array(remaining[start..<end])
                start = end

                let fetched = try await fetchBackfillBatch(accountId: accountId, email: email, threadIDs: chunk, token: &token)
                try checkBackgroundActive()
                guard try await accountStillNeedsBackfill(accountId) else { return true }

                let pending = try await pendingResourceIDs(accountId: accountId, threadIDs: chunk)
                var txStatements: [(String, [Any])] = []
                for id in chunk {
                    if !pending.contains(id), let thread = fetched[id] {
                        txStatements.append(contentsOf: Self.buildThreadStorageStatements(accountId: accountId, thread: thread))
                    }
                    storedIds.append(id)
                    completed += 1
                }
                checkpoint["storedIds"] = storedIds
                checkpoint["completed"] = completed
                txStatements.append((
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
                    [key, try encodeCheckpoint(checkpoint)]
                ))
                _ = try await Self.committed(txStatements)
            }

            if let nextPageToken = listResponse["nextPageToken"] as? String, !nextPageToken.isEmpty {
                checkpoint["pageToken"] = nextPageToken
                checkpoint["storedIds"] = [String]()
                try checkBackgroundActive()
                guard try await accountStillNeedsBackfill(accountId) else { return true }
                _ = try await Self.committed([(
                    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
                    [key, try encodeCheckpoint(checkpoint)]
                )])
            } else {
                break
            }
        }

        try checkBackgroundActive()
        guard let historyId = checkpoint["historyId"] as? String, !historyId.isEmpty else { return false }
        _ = try await Self.committed([
            ("UPDATE accounts SET history_id = $1, last_sync_at = unixepoch(), updated_at = unixepoch() WHERE id = $2", [historyId, accountId]),
            ("INSERT INTO settings (key, value) VALUES ($1, '') ON CONFLICT(key) DO UPDATE SET value = ''", [key]),
        ])
        return true
    }

    /// Runs historical metadata backfill for any Gmail account that does not yet have a history cursor.
    /// Returns true when all active Gmail accounts are caught up.
    private func backfillWork(deadline: Date) async throws -> Bool {
        let accounts = try await accountsNeedingBackfill()
        guard !accounts.isEmpty else { return true }
        let daysBack = await readSyncPeriodDays()
        var allFinished = true
        for account in accounts {
            try checkBackgroundActive()
            if Date() >= deadline { return false }
            guard let id = account["id"] as? String, !id.isEmpty,
                  let email = account["email"] as? String, !email.isEmpty else { continue }
            do {
                let done = try await backfillAccount(id: id, email: email, daysBack: daysBack, deadline: deadline)
                if !done { allFinished = false }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // One rate-limited or revoked account must not starve other accounts.
                allFinished = false
            }
        }
        return allFinished
    }
}
