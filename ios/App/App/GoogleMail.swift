import AppAuth
import Foundation
import UIKit

@MainActor
final class GoogleMail {
    static let shared = GoogleMail()
    static let inboxScope = "https://www.googleapis.com/auth/gmail.modify"
    static let base = "https://www.googleapis.com/gmail/v1/users/me"
    private var flow: OIDExternalUserAgentSession?
    private var authorizationInProgress = false
    private var states: [String: OIDAuthState] = [:]

    private static func key(_ email: String) -> String {
        "gmail:" + email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    func resume(_ url: URL) -> Bool {
        flow?.resumeExternalUserAgentFlow(with: url) ?? false
    }

    func authorize(from presenter: UIViewController, expected: String?) async throws -> [String: String] {
        guard !authorizationInProgress else { throw MailError("Finish the current Google sign-in first.") }
        guard let client = Bundle.main.object(forInfoDictionaryKey: "SuiteMailGoogleClientID") as? String,
              client.hasSuffix(".apps.googleusercontent.com") else {
            throw MailError("Google sign-in is unavailable in this build. Ask the beta organizer for a configured build.")
        }
        let scheme = client.split(separator: ".").reversed().joined(separator: ".")
        guard let redirect = URL(string: "\(scheme):/oauthredirect") else { throw MailError("Invalid Google sign-in configuration.") }
        let config = OIDServiceConfiguration(authorizationEndpoint: URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!,
                                              tokenEndpoint: URL(string: "https://oauth2.googleapis.com/token")!)
        var parameters = ["access_type": "offline", "prompt": "consent select_account"]
        if let expected { parameters["login_hint"] = expected }
        let request = OIDAuthorizationRequest(configuration: config, clientId: client, clientSecret: nil,
                                              scopes: [Self.inboxScope], redirectURL: redirect,
                                              responseType: OIDResponseTypeCode, additionalParameters: parameters)
        authorizationInProgress = true
        defer { flow = nil; authorizationInProgress = false }

        let state: OIDAuthState = try await withCheckedThrowingContinuation { continuation in
            flow = OIDAuthState.authState(byPresenting: request, presenting: presenter) { state, error in
                if let state { continuation.resume(returning: state) }
                else if (error as NSError?)?.code == OIDErrorCode.userCanceledAuthorizationFlow.rawValue {
                    continuation.resume(throwing: MailError("Google sign-in was cancelled."))
                } else { continuation.resume(throwing: MailError("Google sign-in could not be completed. Try again.")) }
            }
        }

        guard let accessToken = state.lastTokenResponse?.accessToken, state.refreshToken != nil,
              (state.scope ?? "").split(separator: " ").contains(Substring(Self.inboxScope)) else {
            throw MailError("Allow SuiteMail to read and manage your Gmail to connect this account.")
        }
        let profile = try await Self.request(URL(string: Self.base + "/profile")!, headers: ["Authorization": "Bearer " + accessToken])
        guard profile.http.statusCode == 200, let data = try JSONSerialization.jsonObject(with: profile.data) as? [String: Any],
              let email = data["emailAddress"] as? String, !email.isEmpty else { throw MailError("Could not confirm the Gmail address.") }
        let key = Self.key(email)
        if let expected, Self.key(expected) != key {
            throw MailError("Signed in as \(email). Reconnect using \(expected).")
        }
        do {
            try save(state, key)
            states[key] = state
        } catch {
            throw MailError("Could not save the Gmail authorization.")
        }
        return ["email": email]
    }

    private func save(_ state: OIDAuthState, _ key: String) throws {
        let data = try NSKeyedArchiver.archivedData(withRootObject: state, requiringSecureCoding: true)
        try MailStorage.write(data, for: key)
    }

    func token(_ email: String, invalid: String? = nil) async throws -> (value: String, expiration: Date) {
        let key = Self.key(email)
        let state: OIDAuthState
        if let current = states[key] { state = current }
        else {
            guard let data = try MailStorage.read(key),
                  let saved = try NSKeyedUnarchiver.unarchivedObject(ofClass: OIDAuthState.self, from: data) else {
                throw MailError("Reconnect Gmail in Accounts to sync this mailbox.")
            }
            state = saved
            states[key] = state
        }
        if let invalid, invalid == state.lastTokenResponse?.accessToken { state.setNeedsTokenRefresh() }
        let access: String = try await withCheckedThrowingContinuation { continuation in
            state.performAction { access, _, error in
                if let access { continuation.resume(returning: access) }
                else if (error as NSError?)?.domain == NSURLErrorDomain {
                    continuation.resume(throwing: MailError("Network error while renewing Gmail access."))
                } else { continuation.resume(throwing: MailError("Reconnect Gmail in Accounts to sync this mailbox.")) }
            }
        }
        try Task.checkCancellation()
        guard states[key] === state else { throw MailError("Gmail authorization changed. Try again.") }
        try save(state, key)
        return (access, state.lastTokenResponse?.accessTokenExpirationDate ?? Date())
    }

    func remove(_ email: String) throws {
        let key = Self.key(email)
        try MailStorage.remove(key)
        states.removeValue(forKey: key)
    }

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 25
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    nonisolated static func request(_ url: URL, method: String = "GET", headers: [String: String], body: String? = nil,
                                    timeout: TimeInterval = 15) async throws -> (data: Data, http: HTTPURLResponse) {
        guard url.scheme == "https", url.host == "www.googleapis.com", url.user == nil, url.password == nil,
              url.port == nil, url.path.hasPrefix("/gmail/v1/users/me/") || (url.path == "/batch/gmail/v1" && method == "POST")
        else { throw MailError("Invalid Gmail URL.") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for name in ["Authorization", "Content-Type"] {
            if let header = headers.first(where: { $0.key.caseInsensitiveCompare(name) == .orderedSame })?.value {
                request.setValue(header, forHTTPHeaderField: name)
            }
        }
        request.httpBody = body.map { Data($0.utf8) }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw MailError("Invalid Gmail response.") }
        return (data, http)
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
