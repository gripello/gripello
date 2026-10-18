import Foundation
import Security

// Session in the shared Keychain group, last good numbers in the App Group (both targets carry both).
enum WidgetStore {

    struct Session: Codable {
        var token: String
        var userId: String
        var origin: String
    }

    static let appGroup = "group.app.gripello"
    static var shared: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    private static let service = "app.gripello.widget"
    private static let account = "session"

    // $(AppIdentifierPrefix)app.gripello.shared, filled in by Xcode through Info.plist.
    private static var accessGroup: String? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "GripelloKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { return nil }
        return group
    }

    private static func query() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    static func loadSession() -> Session? {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    static func saveSession(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        SecItemDelete(query() as CFDictionary)
        var item = query()
        item[kSecValueData as String] = data
        // The widget refreshes in the background, also while the phone is locked.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    // Signing out also drops the numbers drawn for the previous climber.
    static func clearSession() {
        SecItemDelete(query() as CFDictionary)
        for key in shared.dictionaryRepresentation().keys where key.hasPrefix(snapshotPrefix) {
            shared.removeObject(forKey: key)
        }
    }

    // A load that started before the app handed over a new session must not sign that one out.
    static func clearSession(ifToken token: String) {
        guard loadSession()?.token == token else { return }
        clearSession()
    }

    static let snapshotPrefix = "widget.snapshot."
    static let gymsKey = snapshotPrefix + "gyms"
}
