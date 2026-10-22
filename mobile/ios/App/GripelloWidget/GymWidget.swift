import SwiftUI
import WidgetKit

struct GymEntry: TimelineEntry {
    let date: Date
    let state: GymState
    let gymName: String?
}

struct GymProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> GymEntry {
        GymEntry(date: .now, state: .stats(.sample), gymName: "Gripello")
    }

    func snapshot(for configuration: GymWidgetIntent, in context: Context) async -> GymEntry {
        if context.isPreview { return placeholder(in: context) }
        return await entry(for: configuration)
    }

    // Every 30 minutes (the open status follows within that), and when the new week starts.
    func timeline(for configuration: GymWidgetIntent, in context: Context) async -> Timeline<GymEntry> {
        let entry = await entry(for: configuration)
        let nextWeek = Calendar(identifier: .iso8601).date(byAdding: .weekOfYear, value: 1, to: WidgetAPI.weekStart()) ?? .now
        return Timeline(entries: [entry], policy: .after(min(.now.addingTimeInterval(30 * 60), nextWeek)))
    }

    // As for "My climbing", only the current gym list confirms a picked gym.
    private func entry(for configuration: GymWidgetIntent) async -> GymEntry {
        guard let picked = configuration.gym else { return GymEntry(date: .now, state: await WidgetAPI.loadGym(gym: nil), gymName: nil) }
        async let listed = WidgetAPI.lists(gym: picked.id)
        let state = await WidgetAPI.loadGym(gym: picked.id)
        if case .signedOut = state { return GymEntry(date: .now, state: state, gymName: nil) }
        return await listed ? GymEntry(date: .now, state: state, gymName: picked.name) : GymEntry(date: .now, state: .noGym, gymName: nil)
    }
}

struct GymWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "app.gripello.gym", intent: GymWidgetIntent.self, provider: GymProvider()) { entry in
            GymWidgetView(entry: entry)
                .containerBackground(Palette.background, for: .widget)
        }
        .configurationDisplayName("My gym")
        .description("Open now, this week’s new routes and the next reset.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct GymWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: GymEntry

    var body: some View {
        switch entry.state {
        case .signedOut:
            SignedOutView().widgetURL(URL(string: WidgetAPI.defaultOrigin + "/auth/login"))
        case .noGym:
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: "building.2").font(.title2).foregroundStyle(Palette.brand)
                Text("Pick a gym").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        case .stats(let stats):
            Group {
                if family == .systemMedium {
                    HStack(alignment: .top, spacing: 14) {
                        GymSummary(stats: stats, gymName: entry.gymName, small: false, now: entry.date)
                        GymDetails(stats: stats).frame(maxWidth: .infinity)
                    }
                } else {
                    GymSummary(stats: stats, gymName: entry.gymName, small: true, now: entry.date)
                }
            }
            .widgetURL(URL(string: stats.origin + (stats.slug.map { "/" + $0 } ?? "")))
        }
    }
}

private struct GymSummary: View {
    let stats: GymStats
    let gymName: String?
    let small: Bool
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(gymName ?? String(localized: "Pick a gym"))
                .font(.caption.weight(.bold))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
            if let status = OpeningHours.status(stats.hours, now: now) {
                HStack(spacing: 6) {
                    Circle().fill(status.open ? Palette.brand : Palette.muted).frame(width: 7, height: 7)
                    Text(status.text).lineLimit(1)
                }
                .font(.caption2.weight(.bold))
                .foregroundStyle(status.open ? Palette.openText : Palette.text)
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(status.open ? Palette.openBackground : Palette.card, in: Capsule())
            }
            BigNumber(value: stats.newCount, label: "New routes")
            Spacer(minLength: 0)
            if small && stats.newCount > 0 {
                HStack(spacing: 4) {
                    ForEach(Array(stats.colors.enumerated()), id: \.offset) { _, color in
                        Circle().fill(Color(hex: color)).aspectRatio(1, contentMode: .fit).frame(maxWidth: 15)
                    }
                }
            }
            // Small: the reset replaces the hold dots of an empty week. Medium: next to the routes, else it is the main card.
            if let reset = ResetText(stats: stats), small ? stats.newCount == 0 : stats.newCount > 0 {
                Label(reset.banner, systemImage: "calendar")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Palette.streakText)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.streakBackground, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct GymDetails: View {
    let stats: GymStats

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !stats.routes.isEmpty {
                CardLabel(text: stats.followed ? "On walls you follow" : "Newest")
                ForEach(stats.routes, id: \.self) { route in
                    Card {
                        HStack(spacing: 8) {
                            Circle().fill(Color(hex: route.color)).frame(width: 13, height: 13)
                            Text(route.grade)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Palette.text)
                                .frame(minWidth: 30)
                                .padding(.vertical, 1)
                                .background(Palette.track, in: RoundedRectangle(cornerRadius: 5))
                            VStack(alignment: .leading, spacing: 0) {
                                Text(route.name).font(.caption.weight(.bold)).foregroundStyle(Palette.text).lineLimit(1)
                                Text(joined(route.wall, ago(route.created))).font(.system(size: 10)).foregroundStyle(Palette.muted).lineLimit(1)
                            }
                        }
                    }
                }
            } else {
                if let reset = ResetText(stats: stats) {
                    VStack(alignment: .leading, spacing: 4) {
                        CardLabel(text: "Next reset", color: Palette.streakText)
                        Text(reset.title).font(.subheadline.weight(.black)).foregroundStyle(Palette.text).lineLimit(2)
                    }
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .background(Palette.streakBackground, in: RoundedRectangle(cornerRadius: 14))
                } else {
                    Card {
                        Text("No new routes this week").font(.caption).foregroundStyle(Palette.text).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                if let last = stats.lastNew {
                    Card {
                        HStack {
                            Text("Last new route").font(.caption2).foregroundStyle(Palette.muted)
                            Spacer(minLength: 6)
                            Text(joined(last.wall, ago(last.created))).font(.caption2.weight(.bold)).foregroundStyle(Palette.text).lineLimit(1)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func ago(_ timestamp: String) -> String {
        guard let date = ISO8601DateFormatter.withFractionalSeconds.date(from: timestamp) else { return "" }
        return RelativeDateTimeFormatter.days.localizedString(for: Calendar.current.startOfDay(for: date), relativeTo: Calendar.current.startOfDay(for: .now))
    }
}

private func joined(_ first: String, _ second: String) -> String {
    [first, second].filter { !$0.isEmpty }.joined(separator: " · ")
}

private struct ResetText {
    let banner: String
    let title: String

    init?(stats: GymStats) {
        guard let day = stats.resetDate.flatMap(WidgetAPI.parseDay) else { return nil }
        let date = day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        var wall = stats.resetWall ?? ""
        if !wall.isEmpty && stats.resetMoreWalls > 0 { wall += " +\(stats.resetMoreWalls)" }
        banner = wall.isEmpty ? String(localized: "Reset \(date)") : String(localized: "\(wall) resets \(date)")
        title = joined(wall, date)
    }
}

extension ISO8601DateFormatter {
    // API timestamps: RFC 3339 UTC with milliseconds.
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

// Port of openStatus in shared/utils/openingHours.ts (Android: OpeningHours.java).
enum OpeningHours {
    static let weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    struct Status {
        let open: Bool
        let time: String
        // nil = today, else the weekday (Monday = 0) it opens on
        let day: Int?

        var text: String {
            if open { return String(localized: "Open · until \(time)") }
            if time.isEmpty { return String(localized: "Closed") }
            guard let day else { return String(localized: "Closed · opens \(time)") }
            let symbols = Calendar.current.shortWeekdaySymbols
            return String(localized: "Closed · opens \(time) \(symbols[(day + 1) % 7])")
        }
    }

    // nil when the gym keeps no opening hours.
    static func status(_ hours: [String: [[String]]]?, now: Date) -> Status? {
        guard let hours else { return nil }
        let calendar = Calendar.current
        let index = WidgetAPI.weekday(now)
        let time = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        let today = intervals(hours, weekdays[index])
        let yesterday = intervals(hours, weekdays[(index + 6) % 7])

        if let late = yesterday.first(where: { crossesMidnight($0) && time < minutes($0[1]) }) { return Status(open: true, time: late[1], day: nil) }
        if let current = today.first(where: { minutes($0[0]) <= time && (crossesMidnight($0) || time < minutes($0[1])) }) {
            return Status(open: true, time: current[1], day: nil)
        }
        if let later = today.filter({ minutes($0[0]) > time }).min(by: { minutes($0[0]) < minutes($1[0]) }) {
            return Status(open: false, time: later[0], day: nil)
        }
        for offset in 1...7 {
            let day = (index + offset) % 7
            if let first = intervals(hours, weekdays[day]).min(by: { minutes($0[0]) < minutes($1[0]) }) {
                return Status(open: false, time: first[0], day: day)
            }
        }
        return intervals(hours, "holiday").isEmpty ? nil : Status(open: false, time: "", day: nil)
    }

    private static func intervals(_ hours: [String: [[String]]], _ day: String) -> [[String]] {
        (hours[day] ?? []).filter { $0.count == 2 }
    }

    private static func minutes(_ time: String) -> Int {
        let parts = time.split(separator: ":")
        guard parts.count == 2, let hours = Int(parts[0]), let minutes = Int(parts[1]) else { return 0 }
        return hours * 60 + minutes
    }

    private static func crossesMidnight(_ interval: [String]) -> Bool {
        minutes(interval[1]) < minutes(interval[0])
    }
}
