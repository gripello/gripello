import Foundation

struct ClimbingStats: Codable, Hashable {
    struct Send: Codable, Hashable {
        var name: String
        var grade: String
        var color: String
        var flash: Bool
    }

    var sends: Int
    var flashes: Int
    var hardest: Send?
    var latest: [Send]
    var streak: Int
    var unread: Int
    var origin: String

    static let sample = ClimbingStats(
        sends: 12, flashes: 4,
        hardest: .init(name: "Crimp City", grade: "7A", color: "#E53935", flash: false),
        latest: [
            .init(name: "Crimp City", grade: "7A", color: "#E53935", flash: false),
            .init(name: "Slab Happy", grade: "6B+", color: "#1E88E5", flash: true),
            .init(name: "Pinch Me", grade: "6C", color: "#FDD835", flash: false),
        ],
        streak: 5, unread: 2, origin: "https://gripello.app"
    )
}

enum WidgetState: Hashable {
    case stats(ClimbingStats)
    case signedOut
}

// The widget reads the climber's own logbook with the session the app handed over (WidgetStore).
enum WidgetAPI {

    private struct Unauthorized: Error {}

    private struct TickPage: Decodable {
        struct Tick: Decodable {
            struct Expand: Decodable {
                struct Route: Decodable { var color: String? }
                var route: Route?
            }
            var type: String
            var grade: String
            var grade_system: String
            var grade_index: Double
            var route_name: String
            var expand: Expand?
        }
        var items: [Tick]
    }

    private struct Achievement: Decodable {
        var key: String
        var current: Int
    }

    private struct Total: Decodable { var total: Int? }
    private struct Gyms: Decodable { var items: [Gym] }
    struct Gym: Codable { var id: String; var name: String }
    private struct Refreshed: Decodable { var token: String }

    static let defaultOrigin = "https://gripello.app"

    static func load(gym: String?) async -> WidgetState {
        guard var session = WidgetStore.loadSession() else { return .signedOut }
        let cacheKey = WidgetStore.snapshotPrefix + (gym ?? "all")
        do {
            session = try await refreshed(session)
            async let ticks: TickPage = get("/me/ticks", session, query: weekQuery(gym: gym))
            async let achievements: [Achievement]? = try? get("/climbers/\(session.userId)/achievements", session)
            async let unread: Total? = try? get("/me/notifications", session, query: ["unread": "true", "limit": "1"])
            let stats = summarize(try await ticks.items,
                                  streak: await achievements?.first { $0.key == "active_weeks" }?.current ?? 0,
                                  unread: await unread?.total ?? 0,
                                  origin: session.origin)
            WidgetStore.shared.set(try? JSONEncoder().encode(stats), forKey: cacheKey)
            return .stats(stats)
        } catch is Unauthorized {
            // A revoked or expired session: the app signs the widget in again on its next start.
            WidgetStore.clearSession(ifToken: session.token)
            return .signedOut
        } catch {
            // Offline or a server hiccup: keep showing the last good numbers.
            if let data = WidgetStore.shared.data(forKey: cacheKey),
               let cached = try? JSONDecoder().decode(ClimbingStats.self, from: data) {
                return .stats(cached)
            }
            return .stats(.init(sends: 0, flashes: 0, hardest: nil, latest: [], streak: 0, unread: 0, origin: session.origin))
        }
    }

    // Gyms for the widget's picker (the session adds its climber's hidden gyms); offline the last list keeps a picked gym.
    static func gyms() async throws -> [Gym] {
        let session = WidgetStore.loadSession()
        do {
            var request = URLRequest(url: try url(session?.origin ?? defaultOrigin, "/gyms", query: [:]))
            if let session { request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization") }
            let (data, _) = try await URLSession.shared.data(for: request)
            let gyms = try JSONDecoder().decode(Gyms.self, from: data).items
            WidgetStore.shared.set(try? JSONEncoder().encode(gyms), forKey: WidgetStore.gymsKey)
            return gyms
        } catch {
            guard let data = WidgetStore.shared.data(forKey: WidgetStore.gymsKey),
                  let cached = try? JSONDecoder().decode([Gym].self, from: data) else { throw error }
            return cached
        }
    }

    static func weekStart(_ now: Date = .now) -> Date {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        return calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
    }

    private static func weekQuery(gym: String?) -> [String: String] {
        var query = ["since": ISO8601DateFormatter().string(from: weekStart()), "limit": "1000"]
        if let gym { query["gym"] = gym }
        return query
    }

    // Boulder and route grades share no axis, so the hardest comes from the week's most climbed grade system.
    private static func summarize(_ ticks: [TickPage.Tick], streak: Int, unread: Int, origin: String) -> ClimbingStats {
        let sends = ticks.filter { $0.type != "attempt" }
        let system = Dictionary(grouping: sends, by: \.grade_system).max { $0.value.count < $1.value.count }?.key
        let send = { (tick: TickPage.Tick) in
            ClimbingStats.Send(name: tick.route_name, grade: tick.grade,
                               color: tick.expand?.route?.color ?? "#9E9E9E", flash: tick.type == "flash")
        }
        return ClimbingStats(
            sends: sends.count,
            flashes: sends.filter { $0.type == "flash" }.count,
            hardest: sends.filter { $0.grade_system == system }.max { $0.grade_index < $1.grade_index }.map(send),
            latest: sends.prefix(3).map(send),
            streak: streak, unread: unread, origin: origin
        )
    }

    // Same rule as the web app (app/utils/session.ts): renew once less than 6 days are left.
    private static func refreshed(_ session: WidgetStore.Session) async throws -> WidgetStore.Session {
        guard let exp = expiry(session.token), exp.timeIntervalSinceNow < 6 * 24 * 3600 else { return session }
        var request = URLRequest(url: try url(session.origin, "/auth/refresh", query: [:]))
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 401 { throw Unauthorized() }
        guard let token = try? JSONDecoder().decode(Refreshed.self, from: data).token else { return session }
        var next = session
        next.token = token
        WidgetStore.saveSession(next)
        return next
    }

    private static func expiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var payload = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = claims["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    private static func get<T: Decodable>(_ path: String, _ session: WidgetStore.Session, query: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: try url(session.origin, path, query: query))
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw Unauthorized() }
        guard (200..<300).contains(status) else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func url(_ origin: String, _ path: String, query: [String: String]) throws -> URL {
        guard var components = URLComponents(string: origin + "/api" + path) else { throw URLError(.badURL) }
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = components.url else { throw URLError(.badURL) }
        return url
    }
}
