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
    // Monday first
    var days: [Int]
    var streak: Int
    var rank: Int
    var rankMove: Int
    var rankWeek: String?
    var rankBase: Int
    var lastClimb: String?
    var origin: String

    static func empty(origin: String) -> ClimbingStats {
        ClimbingStats(sends: 0, flashes: 0, hardest: nil, days: Array(repeating: 0, count: 7), streak: 0,
                      rank: 0, rankMove: 0, rankWeek: nil, rankBase: 0, lastClimb: nil, origin: origin)
    }

    static let sample = ClimbingStats(
        sends: 8, flashes: 3,
        hardest: .init(name: "Crimp City", grade: "6b+", color: "#E53935", flash: false),
        days: [0, 3, 0, 5, 0, 0, 0],
        streak: 4, rank: 14, rankMove: 3, rankWeek: nil, rankBase: 0, lastClimb: nil, origin: "https://gripello.app"
    )
}

struct GymStats: Codable, Hashable {
    struct NewRoute: Codable, Hashable {
        var name: String
        var grade: String
        var color: String
        var wall: String
        var created: String
    }

    var hours: [String: [[String]]]?
    var newCount: Int
    var followed: Bool
    var routes: [NewRoute]
    var colors: [String]
    var resetWall: String?
    var resetMoreWalls: Int
    var resetDate: String?
    var lastNew: NewRoute?
    var origin: String
    var slug: String?

    static func empty(origin: String) -> GymStats {
        GymStats(hours: nil, newCount: 0, followed: false, routes: [], colors: [], resetWall: nil, resetMoreWalls: 0,
                 resetDate: nil, lastNew: nil, origin: origin, slug: nil)
    }

    static let sample = GymStats(
        hours: nil, newCount: 7, followed: true,
        routes: [
            .init(name: "Roter Riese", grade: "6c", color: "#E53935", wall: "The Cave", created: ""),
            .init(name: "Lila Laune", grade: "6a+", color: "#8E24AA", wall: "Slab", created: ""),
            .init(name: "Blaue Stunde", grade: "6a", color: "#1E88E5", wall: "Slab", created: ""),
        ],
        colors: ["#FDD835", "#1E88E5", "#E53935", "#212121", "#43A047", "#8E24AA", "#FB8C00"],
        resetWall: "Overhang", resetMoreWalls: 0, resetDate: nil, lastNew: nil, origin: "https://gripello.app", slug: nil
    )
}

enum WidgetState: Hashable {
    case stats(ClimbingStats)
    case signedOut
}

enum GymState: Hashable {
    case stats(GymStats)
    case signedOut
    case noGym
}

// The widgets read the climber's own logbook and the gym's public routes with the session the app handed over (WidgetStore).
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
            var date: String
            var expand: Expand?
        }
        var items: [Tick]
    }

    private struct Achievement: Decodable {
        var key: String
        var current: Int
    }

    private struct Season: Decodable {
        var id: String
        var starts_at: String
        var ends_at: String
    }

    private struct Board: Decodable {
        struct Row: Decodable { var rank: Int }
        var me: Row?
    }

    private struct Me: Decodable { var followed_walls: [String]? }

    private struct GymInfo: Decodable {
        var slug: String?
        var opening_hours: [String: [[String]]?]?
    }

    private struct RoutePage: Decodable {
        struct Route: Decodable {
            struct Expand: Decodable {
                struct Wall: Decodable { var name: String }
                var wall: Wall?
            }
            var name: String
            var grade: String
            var color: String
            var wall: String
            var created: String
            var removal_planned_for: String?
            var expand: Expand?

            var row: GymStats.NewRoute {
                .init(name: name, grade: grade, color: color, wall: expand?.wall?.name ?? "", created: created)
            }
        }
        var items: [Route]
        var total: Int?
    }

    private struct Gyms: Decodable { var items: [Gym] }
    struct Gym: Codable { var id: String; var name: String }
    private struct Refreshed: Decodable { var token: String }

    static let defaultOrigin = "https://gripello.app"
    private static let gymRouteRows = 3
    private static let gymHoldDots = 7

    static func load(gym: String?) async -> WidgetState {
        guard var session = WidgetStore.loadSession() else { return .signedOut }
        let cacheKey = WidgetStore.snapshotPrefix + (gym ?? "all")
        let previous = WidgetStore.shared.data(forKey: cacheKey).flatMap { try? JSONDecoder().decode(ClimbingStats.self, from: $0) }
        do {
            session = try await refreshed(session)
            async let ticks: TickPage = get("/me/ticks", session, query: weekQuery(gym: gym))
            async let achievements: [Achievement]? = try? get("/climbers/\(session.userId)/achievements", session)
            async let rank = boardRank(gym: gym, session)
            var stats = summarize(try await ticks.items, origin: session.origin)
            stats.streak = await achievements?.first { $0.key == "active_weeks" }?.current ?? 0
            stats.rank = try await rank
            if stats.sends == 0 { stats.lastClimb = try await lastClimb(gym: gym, session) }
            stats = withRankMove(stats, previous: previous)
            WidgetStore.saveSnapshot(try? JSONEncoder().encode(stats), forKey: cacheKey, ifToken: session.token)
            return .stats(stats)
        } catch is Unauthorized {
            // A revoked or expired session: the app signs the widget in again on its next start.
            WidgetStore.clearSession(ifToken: session.token)
            return .signedOut
        } catch {
            // Offline or a server hiccup: keep showing the last good numbers.
            return .stats(previous ?? .empty(origin: session.origin))
        }
    }

    static func loadGym(gym: String?) async -> GymState {
        guard var session = WidgetStore.loadSession() else { return .signedOut }
        guard let gym else { return .noGym }
        let cacheKey = WidgetStore.snapshotPrefix + "gym." + gym
        do {
            session = try await refreshed(session)
            let base = "/gyms/\(gym)"
            async let info: GymInfo = get(base, session)
            async let me: Me? = try? get("/me", session)
            async let created: RoutePage = get(base + "/routes", session, query: [
                "since": ISO8601DateFormatter().string(from: weekStart()), "include": "wall", "limit": "100", "total": "true",
            ])
            // The reset is extra; the new routes still show without it.
            async let planned: RoutePage? = try? get(base + "/routes", session, query: [
                "removal": "planned", "sort": "removal_planned_for", "include": "wall", "limit": "1000",
            ])
            let page = try await created
            var stats = GymStats.empty(origin: session.origin)
            let details = try await info
            stats.slug = details.slug
            stats.hours = details.opening_hours?.compactMapValues { $0 }
            stats.newCount = page.total ?? page.items.count
            summarizeNew(&stats, page.items, followed: Set(await me?.followed_walls ?? []))
            if let planned = await planned { nextReset(&stats, planned.items) }
            if stats.newCount == 0 {
                let newest: RoutePage? = try? await get(base + "/routes", session, query: ["limit": "1", "include": "wall"])
                stats.lastNew = newest?.items.first?.row
            }
            WidgetStore.saveSnapshot(try? JSONEncoder().encode(stats), forKey: cacheKey, ifToken: session.token)
            return .stats(stats)
        } catch is Unauthorized {
            WidgetStore.clearSession(ifToken: session.token)
            return .signedOut
        } catch {
            if let data = WidgetStore.shared.data(forKey: cacheKey),
               let cached = try? JSONDecoder().decode(GymStats.self, from: data) {
                return .stats(cached)
            }
            return .stats(.empty(origin: session.origin))
        }
    }

    // Gyms for the widgets' picker (the session adds its climber's hidden gyms); offline the last list keeps a picked gym.
    static func gyms() async throws -> [Gym] {
        let session = WidgetStore.loadSession()
        do {
            var request = URLRequest(url: try url(session?.origin ?? defaultOrigin, "/gyms", query: [:]))
            if let session { request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization") }
            let (data, _) = try await URLSession.shared.data(for: request)
            let gyms = try JSONDecoder().decode(Gyms.self, from: data).items
            if let session {
                WidgetStore.saveSnapshot(try? JSONEncoder().encode(gyms), forKey: WidgetStore.gymsKey, ifToken: session.token)
            }
            return gyms
        } catch {
            guard let data = WidgetStore.shared.data(forKey: WidgetStore.gymsKey),
                  let cached = try? JSONDecoder().decode([Gym].self, from: data) else { throw error }
            return cached
        }
    }

    // Whether the signed-in climber's current gyms (the cached list only offline) include this one.
    static func lists(gym id: String) async -> Bool {
        guard WidgetStore.loadSession() != nil, let list = try? await gyms() else { return false }
        return list.contains(where: { $0.id == id })
    }

    static func weekStart(_ now: Date = .now) -> Date {
        var calendar = Calendar(identifier: .iso8601)
        calendar.timeZone = .current
        return calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
    }

    static func day(_ date: Date) -> String {
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .iso8601)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = .current
        format.dateFormat = "yyyy-MM-dd"
        return format.string(from: date)
    }

    // At noon: midnight doesn't exist on the day a time zone switches to daylight saving at 00:00.
    static func parseDay(_ day: String) -> Date? {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = .current
        format.dateFormat = "yyyy-MM-dd HH"
        return format.date(from: day + " 12")
    }

    // Ticks carry a plain day and the API reads a timestamp as its UTC day, so the week starts at the local Monday's date.
    private static func weekQuery(gym: String?) -> [String: String] {
        var query = ["since": day(weekStart()), "limit": "1000"]
        if let gym { query["gym"] = gym }
        return query
    }

    // Monday = 0.
    static func weekday(_ date: Date) -> Int {
        (Calendar(identifier: .gregorian).component(.weekday, from: date) + 5) % 7
    }

    // Boulder and route grades share no axis, so the hardest comes from the week's most climbed grade system.
    private static func summarize(_ ticks: [TickPage.Tick], origin: String) -> ClimbingStats {
        let sends = ticks.filter { $0.type != "attempt" }
        let counts = sends.reduce(into: [String: Int]()) { $0[$1.grade_system, default: 0] += 1 }
        // A tie goes to the system of the most recent send (the list is newest first), as on Android.
        let top = counts.values.max()
        let system = sends.first { counts[$0.grade_system] == top }?.grade_system
        let send = { (tick: TickPage.Tick) in
            ClimbingStats.Send(name: tick.route_name, grade: tick.grade,
                               color: tick.expand?.route?.color ?? "#9E9E9E", flash: tick.type == "flash")
        }
        var stats = ClimbingStats.empty(origin: origin)
        stats.sends = sends.count
        stats.flashes = sends.filter { $0.type == "flash" }.count
        stats.hardest = sends.filter { $0.grade_system == system }.max { $0.grade_index < $1.grade_index }.map(send)
        for tick in sends {
            if let date = parseDay(tick.date) { stats.days[weekday(date)] += 1 }
        }
        return stats
    }

    // The rank's movement since this widget first saw it this week (the API keeps no rank history).
    static func withRankMove(_ fresh: ClimbingStats, previous: ClimbingStats?) -> ClimbingStats {
        var stats = fresh
        let week = day(weekStart())
        let sameWeek = previous?.rankWeek == week && (previous?.rankBase ?? 0) > 0
        stats.rankWeek = week
        stats.rankBase = sameWeek ? previous!.rankBase : stats.rank
        stats.rankMove = stats.rank > 0 && stats.rankBase > 0 ? stats.rankBase - stats.rank : 0
        return stats
    }

    // The rank on the board the gym page opens first: the running season (else the last 60 days), boulders before routes.
    private static func boardRank(gym: String?, _ session: WidgetStore.Session) async throws -> Int {
        guard let gym else { return 0 }
        let today = day(.now)
        let seasons: [Season]? = try await optional { try await get("/gyms/\(gym)/seasons", session) }
        let season = seasons?.first { $0.starts_at <= today && $0.ends_at >= today }?.id
        for kind in ["boulder", "route"] {
            var query = ["kind": kind]
            if let season { query["season"] = season }
            let board: Board? = try await optional { try await get("/gyms/\(gym)/leaderboard", session, query: query) }
            if let me = board?.me { return me.rank }
        }
        return 0
    }

    // The day of the newest tick (attempts count as climbing), for the "last climb" card of an empty week.
    private static func lastClimb(gym: String?, _ session: WidgetStore.Session) async throws -> String? {
        var query = ["limit": "1"]
        if let gym { query["gym"] = gym }
        let page: TickPage? = try await optional { try await get("/me/ticks", session, query: query) }
        return page?.items.first?.date
    }

    // Extra data: a failure leaves it out, an expired session still signs the widget out.
    private static func optional<T>(_ fetch: () async throws -> T) async throws -> T? {
        do {
            return try await fetch()
        } catch is Unauthorized {
            throw Unauthorized()
        } catch {
            return nil
        }
    }

    // Newest first; routes on followed walls lead, the rest of the gym fills up.
    private static func summarizeNew(_ stats: inout GymStats, _ items: [RoutePage.Route], followed: Set<String>) {
        stats.colors = items.prefix(gymHoldDots).map(\.color)
        let onFollowed = items.filter { followed.contains($0.wall) }
        stats.followed = !onFollowed.isEmpty
        stats.routes = Array((onFollowed + items.filter { !followed.contains($0.wall) }).prefix(gymRouteRows).map(\.row))
    }

    // The earliest planned strip date from today on and the walls coming down that day.
    private static func nextReset(_ stats: inout GymStats, _ items: [RoutePage.Route]) {
        let today = day(.now)
        guard let first = items.first(where: { ($0.removal_planned_for ?? "") >= today })?.removal_planned_for else { return }
        var walls: [String] = []
        for route in items where route.removal_planned_for == first {
            let name = route.expand?.wall?.name ?? ""
            if !walls.contains(name) { walls.append(name) }
        }
        stats.resetDate = first
        stats.resetWall = walls.first ?? ""
        stats.resetMoreWalls = max(0, walls.count - 1)
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
        // The renewed token stays valid for this load even when a newer session won.
        WidgetStore.replaceSession(ifToken: session.token, with: next)
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
