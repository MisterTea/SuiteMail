import BackgroundTasks
import Foundation
import UIKit

@MainActor
final class BackgroundMail {
    static let shared = BackgroundMail()
    private let identifier = "com.suitemail.app.gmail-refresh"
    private var foreground = false
    private var worker: Task<Void, Never>?

    private final class RefreshCompletion {
        private let refresh: BGAppRefreshTask
        private var completed = false

        init(_ refresh: BGAppRefreshTask) { self.refresh = refresh }

        func finish(_ success: Bool) {
            guard !completed else { return }
            completed = true
            refresh.expirationHandler = nil
            refresh.setTaskCompleted(success: success)
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
    }

    func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    func setForeground(_ active: Bool) {
        foreground = active
        if active { worker?.cancel() }
    }

    private func run(_ refresh: BGAppRefreshTask) {
        schedule()
        guard !foreground, worker == nil else { refresh.setTaskCompleted(success: true); return }
        let completion = RefreshCompletion(refresh)
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

    /// Everything a background refresh does.
    private func refreshWork() async throws {
        // Scheduled mail first: it is the time-sensitive part of the refresh window.
        _ = await sendDueScheduled()
        try Task.checkCancellation()
        try await fetch()
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
              entry.request == request, Date().timeIntervalSince(entry.saved) < 15 * 60 else { return nil }
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
            } catch {
                try Task.checkCancellation()
                // A single revoked or unavailable account must not starve the other accounts.
                continue
            }
        }
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
}
