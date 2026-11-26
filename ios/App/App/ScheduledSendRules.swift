import Foundation

/// Pure scheduled-send rules for the iOS sender in BackgroundMail.swift. Mirrors
/// src/services/db/scheduledEmails.ts, calculateNextScheduledOccurrence in
/// src/services/snooze/scheduledSendManager.ts and Android's ScheduledSendRules.java.
enum ScheduledSendRules {
    /// scheduled_at is Unix seconds; anything this large can only be milliseconds written by mistake.
    static let millisecondThreshold: Int64 = 100_000_000_000
    /// A 'sending' claim older than this belongs to a sender that was killed partway.
    static let staleSendingSeconds: Int64 = 10 * 60
    /// `now` is the SQL placeholder bound to the current Unix time.
    static func dueSQL(_ now: String) -> String {
        "(CASE WHEN scheduled_at > \(millisecondThreshold) THEN scheduled_at / 1000 ELSE scheduled_at END) <= \(now) AND (created_at IS NULL OR created_at <= \(now))"
    }

    static func normalize(_ scheduledAt: Int64) -> Int64 {
        scheduledAt > millisecondThreshold ? scheduledAt / 1000 : scheduledAt
    }

    /// Never early: the device clock must have reached scheduled_at and must not read earlier than when the email was scheduled.
    static func isDue(scheduledAt: Int64, createdAt: Int64?, now: Int64) -> Bool {
        if let createdAt, now < createdAt { return false }
        return now >= normalize(scheduledAt)
    }

    static func isRecurring(_ rule: String?) -> Bool {
        guard let rule, !rule.isEmpty else { return false }
        return rule != "none"
    }

    /// Same local-time arithmetic as JS Date#setDate / #setMonth: overflowing days roll forward.
    static func nextOccurrence(_ scheduledAt: Int64, rule: String, calendar: Calendar = .current) -> Int64 {
        let start = Date(timeIntervalSince1970: TimeInterval(normalize(scheduledAt)))
        var parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: start)
        func date() -> Date { calendar.date(from: parts) ?? start }
        switch rule.lowercased() {
        case "daily": parts.day! += 1
        case "weekdays":
            repeat { parts.day! += 1 } while [1, 7].contains(calendar.component(.weekday, from: date()))
        case "monthly": parts.month! += 1
        default: parts.day! += 7
        }
        return Int64(floor(date().timeIntervalSince1970))
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return formatter
    }()

    /// The MIME is built when the email is scheduled. Stamp it with the real send time and a fresh
    /// Message-ID (recurring copies share one MIME). Only the header block is touched.
    static func prepareForSend(_ raw: String, now: Date, unique: String) throws -> String {
        var base64 = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64), let mime = String(data: data, encoding: .isoLatin1) else {
            throw MailError("The scheduled email could not be read.")
        }
        let split = mime.range(of: "\r\n\r\n")?.lowerBound ?? mime.endIndex
        var headers = String(mime[..<split])
        let millis = Int64(now.timeIntervalSince1970 * 1000)
        let date = try NSRegularExpression(pattern: "^Date:[^\\r\\n]*", options: [.anchorsMatchLines, .caseInsensitive])
        if let match = date.firstMatch(in: headers, range: NSRange(headers.startIndex..., in: headers)),
           let range = Range(match.range, in: headers) {
            headers.replaceSubrange(range, with: "Date: " + dateFormatter.string(from: now))
        }
        let id = try NSRegularExpression(pattern: "^Message-ID:[^\\r\\n]*?@([^>\\r\\n]+)>[^\\r\\n]*", options: [.anchorsMatchLines, .caseInsensitive])
        if let match = id.firstMatch(in: headers, range: NSRange(headers.startIndex..., in: headers)),
           let range = Range(match.range, in: headers), let domain = Range(match.range(at: 1), in: headers) {
            headers.replaceSubrange(range, with: "Message-ID: <\(millis).\(unique)@\(headers[domain])>")
        }
        guard let out = (headers + mime[split...]).data(using: .isoLatin1) else { throw MailError("The scheduled email could not be prepared.") }
        return out.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
