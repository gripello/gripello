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

    // Another climber gets none of the previous one's numbers or gym list (maybe hidden gyms).
    static func saveSession(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        if let previous = loadSession(), previous.userId != session.userId { dropSnapshots() }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // The widget refreshes in the background, also while the phone is locked.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        guard SecItemUpdate(query() as CFDictionary, attributes as CFDictionary) == errSecItemNotFound else { return }
        SecItemAdd(query().merging(attributes) { $1 } as CFDictionary, nil)
    }

    // A token renewed by a load that started before a sign-out or a new session is dropped.
    static func replaceSession(ifToken token: String, with next: Session) {
        guard loadSession()?.token == token else { return }
        saveSession(next)
    }

    // A load that outlived a sign-out or a new session keeps its numbers to itself.
    static func saveSnapshot(_ data: Data?, forKey key: String, ifToken token: String) {
        guard loadSession()?.token == token else { return }
        shared.set(data, forKey: key)
    }

    // Signing out also drops the numbers drawn for the previous climber.
    static func clearSession() {
        SecItemDelete(query() as CFDictionary)
        dropSnapshots()
    }

    private static func dropSnapshots() {
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
