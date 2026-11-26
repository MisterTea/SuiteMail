import Capacitor
import Foundation
import QuickLook
import Security
import SuiteMailCore
import UIKit

final class SuiteMailViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SuiteMailPlugin())
    }
}

struct MailError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

enum MailStorage {
    static func directory(_ name: String) throws -> URL {
        var url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                             appropriateFor: nil, create: true).appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
                                               attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        return url
    }

    static func keychain(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.suitemail.app", kSecAttrAccount as String: account]
    }

    static func read(_ account: String) throws -> Data? {
        var query = keychain(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw MailError("Could not read SuiteMail Keychain item.") }
        return data
    }

    static func write(_ data: Data, for account: String) throws {
        let query = keychain(account)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard status == errSecItemNotFound, SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw MailError("Could not save SuiteMail Keychain item.")
        }
    }

    static func remove(_ account: String) throws {
        let status = SecItemDelete(keychain(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw MailError("Could not remove SuiteMail Keychain item.") }
    }
}

enum MailCore {
    // Accessed exclusively from this queue.
    static let database = DispatchQueue(label: "com.suitemail.app.database")
    static let keychain = DispatchQueue(label: "com.suitemail.app.keychain")
    private static var initialized = false

    static func call(_ command: String, _ args: [String: Any]) throws -> Any {
        if command.hasPrefix("db_"), !initialized {
            let path = try MailStorage.directory("Mail").appendingPathComponent("suitemail.db").path
            _ = try invoke("db_init", ["path": path])
            initialized = true
        }
        return try invoke(command, args)
    }

    private static func invoke(_ command: String, _ args: [String: Any]) throws -> Any {
        let bytes = try JSONSerialization.data(withJSONObject: args)
        let json = String(decoding: bytes, as: UTF8.self)
        let result = command.withCString { command in json.withCString { suitemail_ios_call(command, $0) } }
        guard let result else { throw MailError("No response from the mail backend.") }
        defer { suitemail_ios_free(result) }
        let data = Data(String(cString: result).utf8)
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw MailError("Invalid response from the mail backend.")
        }
        if let error = envelope["error"] as? String { throw MailError(error) }
        return envelope["value"] ?? NSNull()
    }
}

@objc(SuiteMailPlugin)
final class SuiteMailPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    let identifier = "SuiteMailPlugin"
    let jsName = "SuiteMailIOS"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "invoke", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "attachment", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "authorizeGoogle", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "googleToken", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "googleRequest", returnType: CAPPluginReturnPromise)!,
        CAPPluginMethod(name: "backgroundMail", returnType: CAPPluginReturnPromise)!,
    ]

    @objc func invoke(_ call: CAPPluginCall) {
        guard let command = call.getString("command") else { call.reject("Missing command."); return }
        guard command != "db_init" else { call.reject("Database initialization is managed by SuiteMail."); return }
        let args = call.getObject("args") ?? [:]
        let queue = command.hasPrefix("db_") ? MailCore.database :
            command == "credential_key" ? MailCore.keychain : DispatchQueue.global(qos: .userInitiated)
        queue.async {
            do {
                if command == "credential_key" {
                    if let key = try MailStorage.read("credential-key") {
                        call.resolve(["value": key.base64EncodedString()])
                        return
                    }
                    var data = Data(count: 32)
                    let status = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
                    guard status == errSecSuccess else { throw MailError("Could not generate credential key.") }
                    try MailStorage.write(data, for: "credential-key")
                    call.resolve(["value": data.base64EncodedString()])
                    return
                }
                if let config = args["config"] as? [String: Any],
                   command.hasPrefix("imap_") || command.hasPrefix("smtp_") {
                    guard let security = config["security"] as? String,
                          ["tls", "starttls"].contains(security),
                          config["accept_invalid_certs"] as? Bool != true else {
                        throw MailError("Use SSL/TLS or STARTTLS with a trusted server certificate.")
                    }
                }
                call.resolve(["value": try MailCore.call(command, args)])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), ["https", "http", "mailto", "tel"].contains(scheme) else {
            call.reject("Unsupported link."); return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { success in
                if success { call.resolve() } else { call.reject("Could not open link.") }
            }
        }
    }

    private var previewURL: URL?

    @objc func attachment(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                guard let controller = self.bridge?.viewController, controller.presentedViewController == nil,
                      let raw = call.getString("data"), let data = Data(base64Encoded: raw),
                      let name = call.getString("filename") else { throw MailError("Could not open attachment.") }
                let sanitized = name.components(separatedBy: CharacterSet(charactersIn: "/\\:").union(.controlCharacters)).joined(separator: "_")
                let filename = sanitized.isEmpty || sanitized == "." || sanitized == ".." ? "Attachment" : sanitized
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                    attributes: [.protectionKey: FileProtectionType.complete])
                let file = directory.appendingPathComponent(filename)
                do { try data.write(to: file, options: [.atomic, .completeFileProtection]) }
                catch { try? FileManager.default.removeItem(at: directory); throw error }
                if call.getBool("preview") == true {
                    self.previewURL = file
                    let preview = QLPreviewController()
                    preview.dataSource = self
                    preview.delegate = self
                    controller.present(preview, animated: true) { call.resolve() }
                } else {
                    let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                    share.popoverPresentationController?.sourceView = controller.view
                    share.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                    share.completionWithItemsHandler = { _, _, _, error in
                        try? FileManager.default.removeItem(at: directory)
                        if let error { call.reject(error.localizedDescription) } else { call.resolve() }
                    }
                    controller.present(share, animated: true)
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        if let url = previewURL { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        previewURL = nil
    }

    @objc func authorizeGoogle(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let presenter = bridge?.viewController else { throw MailError("Cannot open Google sign-in.") }
                let profile = try await GoogleMail.shared.authorize(from: presenter, expected: call.getString("email"))
                call.resolve(profile)
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func googleToken(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                guard let email = call.getString("email") else { throw MailError("Missing Gmail address.") }
                if call.getBool("remove") == true {
                    try GoogleMail.shared.remove(email)
                    call.resolve()
                } else {
                    let token = try await GoogleMail.shared.token(email, invalid: call.getString("invalidToken"))
                    call.resolve(["accessToken": token.value, "expiresAt": token.expiration.timeIntervalSince1970])
                }
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func googleRequest(_ call: CAPPluginCall) {
        Task {
            do {
                guard let raw = call.getString("url"), let url = URL(string: raw) else { throw MailError("Missing Gmail URL.") }
                let method = call.getString("method") ?? "GET"
                if method == "GET", let account = call.getString("account"),
                   let cached = BackgroundMail.shared.take(account, request: url) {
                    call.resolve(["status": 200, "headers": [:], "body": cached.base64EncodedString()])
                    return
                }
                let response = try await GoogleMail.request(url, method: method,
                    headers: call.getObject("headers") as? [String: String] ?? [:], body: call.getString("body"))
                var headers: [String: String] = [:]
                for (key, value) in response.http.allHeaderFields { headers[String(describing: key)] = String(describing: value) }
                call.resolve(["status": response.http.statusCode, "headers": headers, "body": response.data.base64EncodedString()])
            } catch { call.reject(error.localizedDescription) }
        }
    }

    @objc func backgroundMail(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                if call.getString("action") == "discard", let account = call.getString("account") {
                    try BackgroundMail.shared.discard(account)
                    call.resolve()
                } else if call.getString("action") == "sendScheduled" {
                    // BGAppRefreshTask never runs in the foreground, so the open app asks the same sender to run.
                    let result = await BackgroundMail.shared.sendDueScheduled()
                    call.resolve(["sent": result.sent, "failed": result.failed])
                } else { call.reject("Invalid background mail request.") }
            } catch { call.reject(error.localizedDescription) }
        }
    }
}
