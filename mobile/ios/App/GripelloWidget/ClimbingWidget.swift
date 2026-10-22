import SwiftUI
import UIKit
import WidgetKit

struct ClimbingEntry: TimelineEntry {
    let date: Date
    let state: WidgetState
    let gymName: String?
}

struct ClimbingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ClimbingEntry {
        ClimbingEntry(date: .now, state: .stats(.sample), gymName: nil)
    }

    func snapshot(for configuration: ClimbingWidgetIntent, in context: Context) async -> ClimbingEntry {
        if context.isPreview { return placeholder(in: context) }
        return await entry(for: configuration)
    }

    // Every 30 minutes, and when the new week starts so the numbers reset on Monday.
    func timeline(for configuration: ClimbingWidgetIntent, in context: Context) async -> Timeline<ClimbingEntry> {
        let entry = await entry(for: configuration)
        let nextWeek = Calendar(identifier: .iso8601).date(byAdding: .weekOfYear, value: 1, to: WidgetAPI.weekStart()) ?? .now
        return Timeline(entries: [entry], policy: .after(min(.now.addingTimeInterval(30 * 60), nextWeek)))
    }

    // The picked gym outlives sign-out in the system's widget config (maybe another climber's hidden gym): only the current gym list confirms it.
    private func entry(for configuration: ClimbingWidgetIntent) async -> ClimbingEntry {
        guard let picked = configuration.gym else {
            return ClimbingEntry(date: .now, state: await WidgetAPI.load(gym: nil), gymName: nil)
        }
        async let listed = WidgetAPI.lists(gym: picked.id)
        let state = await WidgetAPI.load(gym: picked.id)
        if await listed { return ClimbingEntry(date: .now, state: state, gymName: picked.name) }
        return ClimbingEntry(date: .now, state: await WidgetAPI.load(gym: nil), gymName: nil)
    }
}

struct ClimbingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "app.gripello.climbing", intent: ClimbingWidgetIntent.self, provider: ClimbingProvider()) { entry in
            ClimbingWidgetView(entry: entry)
                .containerBackground(Palette.background, for: .widget)
        }
        .configurationDisplayName("My climbing")
        .description("Your sends this week, your streak and your rank.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

@main
struct GripelloWidgetBundle: WidgetBundle {
    var body: some Widget {
        ClimbingWidget()
        GymWidget()
    }
}

// The site's tokens, as on the Android widgets (values/widget_colors.xml, values-night).
enum Palette {
    static let background = Color(light: 0xFFFFFF, dark: 0x161B22)
    static let text = Color(light: 0x1A1C18, dark: 0xE6E8E3)
    static let muted = Color(light: 0x5F635C, dark: 0x9AA19A)
    static let brand = Color(light: 0x4A9B2F, dark: 0x6FBF4F)
    static let number = Color(light: 0x1A1C18, dark: 0x6FBF4F)
    static let card = Color(light: 0xF2F4F0, dark: 0x1F262F)
    static let track = Color(light: 0xE6E8E3, dark: 0x262D36)
    static let bar = Color(light: 0xA8D394, dark: 0x3F6B30)
    static let streak = Color(light: 0xF57C00, dark: 0xFFA040)
    static let streakBackground = Color(light: 0xFFF1E0, dark: 0x3A2A17)
    static let streakText = Color(light: 0x8A4B00, dark: 0xFFC58A)
    static let openBackground = Color(light: 0xE8F3E1, dark: 0x22341D)
    static let openText = Color(light: 0x2F6B1C, dark: 0xA6DD8E)
    static let rank = Color(light: 0x8A6A00, dark: 0xE8B931)
    static let down = Color(light: 0xB3261E, dark: 0xF2675C)
}

struct ClimbingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ClimbingEntry

    var body: some View {
        switch entry.state {
        case .signedOut:
            SignedOutView()
                .widgetURL(URL(string: WidgetAPI.defaultOrigin + "/auth/login"))
        case .stats(let stats):
            Group {
                switch family {
                case .accessoryRectangular: LockScreenView(stats: stats)
                case .systemMedium:
                    HStack(alignment: .top, spacing: 14) {
                        WeekSummary(stats: stats, gymName: entry.gymName)
                        WeekDetails(stats: stats).frame(maxWidth: .infinity)
                    }
                default: WeekSummary(stats: stats, gymName: entry.gymName)
                }
            }
            .widgetURL(URL(string: stats.origin + "/logbook"))
        }
    }
}

struct SignedOutView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "figure.climbing").font(.title2).foregroundStyle(Palette.brand)
            Text("Sign in to Gripello to see your climbing.")
                .font(.footnote)
                .foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// The big number with its label, shared by both widgets.
struct BigNumber: View {
    let value: Int
    let label: LocalizedStringKey

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Text("\(value)")
                .font(.system(size: 40, weight: .black, design: .rounded))
                .foregroundStyle(Palette.number)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            VStack(alignment: .leading, spacing: 0) {
                Text(label).font(.caption.weight(.bold)).foregroundStyle(Palette.text)
                Text("this week").font(.caption2).foregroundStyle(Palette.muted)
            }
        }
    }
}

struct Chip: View {
    let text: String
    let systemImage: String
    let icon: Color
    let foreground: Color
    let background: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage).foregroundStyle(icon)
            Text(text).lineLimit(1)
        }
        .font(.caption2.weight(.bold))
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(background, in: Capsule())
    }
}

private struct WeekSummary: View {
    let stats: ClimbingStats
    let gymName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(gymName ?? String(localized: "This week"))
                .font(.caption.weight(.bold))
                .foregroundStyle(Palette.muted)
                .lineLimit(1)
            BigNumber(value: stats.sends, label: "Sends")
            WeekChart(days: stats.days)
            if stats.streak > 0 {
                // A streak about to run out turns into a reminder that it ends on Sunday.
                Chip(text: stats.streakRisk ? String(localized: "Ends Sunday") : String(localized: "\(stats.streak) weeks in a row"),
                     systemImage: "flame.fill", icon: Palette.streak, foreground: Palette.streakText, background: Palette.streakBackground)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WeekChart: View {
    let days: [Int]

    var body: some View {
        let today = WidgetAPI.weekday(.now)
        let symbols = Calendar.current.veryShortWeekdaySymbols
        let most = max(days.max() ?? 0, 1)
        VStack(spacing: 3) {
            GeometryReader { geometry in
                HStack(alignment: .bottom, spacing: 5) {
                    ForEach(0..<7, id: \.self) { day in
                        let count = days.indices.contains(day) ? days[day] : 0
                        RoundedRectangle(cornerRadius: 3)
                            .fill(day == today ? Palette.brand : count == 0 ? Palette.track : Palette.bar)
                            .frame(height: count == 0 ? 4 : max(8, geometry.size.height * CGFloat(count) / CGFloat(most)))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
            }
            HStack(spacing: 5) {
                ForEach(0..<7, id: \.self) { day in
                    Text(symbols[(day + 1) % 7])
                        .font(.system(size: 9, weight: day == today ? .bold : .regular))
                        .foregroundStyle(day == today ? Palette.text : Palette.muted)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(minHeight: 12)
    }
}

struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 2) { content }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct CardLabel: View {
    let text: LocalizedStringKey
    var color = Palette.muted

    var body: some View {
        Text(text).textCase(.uppercase).font(.system(size: 9, weight: .bold)).kerning(0.5).foregroundStyle(color).lineLimit(1)
    }
}

private struct WeekDetails: View {
    let stats: ClimbingStats

    var body: some View {
        let active = stats.sends > 0
        VStack(spacing: 8) {
            if active, let hardest = stats.hardest {
                Card {
                    HStack(spacing: 10) {
                        Circle().fill(Color(hex: hardest.color)).frame(width: 26, height: 26)
                        VStack(alignment: .leading, spacing: 0) {
                            CardLabel(text: "Hardest")
                            Text(hardest.grade).font(.system(size: 20, weight: .black)).foregroundStyle(Palette.text)
                        }
                        Spacer(minLength: 4)
                        Text(hardest.name).font(.caption2).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.trailing)
                    }
                    .frame(maxHeight: .infinity)
                }
            } else if !active, stats.streakRisk {
                VStack(alignment: .leading, spacing: 4) {
                    Label(String(localized: "\(stats.streak) weeks in a row"), systemImage: "flame.fill")
                        .font(.subheadline.weight(.black))
                        .foregroundStyle(Palette.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text("Climb by Sunday to keep it going").font(.caption2).foregroundStyle(Palette.streakText)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .background(Palette.streakBackground, in: RoundedRectangle(cornerRadius: 14))
            } else {
                Card {
                    Text("No sends this week yet").font(.caption).foregroundStyle(Palette.text).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            let last = !active ? stats.lastClimb.flatMap(WidgetAPI.parseDay) : nil
            if stats.rank > 0 || active || last != nil {
                HStack(spacing: 8) {
                    if stats.rank > 0 {
                        Card {
                            CardLabel(text: "Rank")
                            HStack(spacing: 4) {
                                Text("#\(stats.rank)").font(.system(size: 18, weight: .black)).foregroundStyle(Palette.rank)
                                if stats.rankMove != 0 {
                                    Image(systemName: stats.rankMove > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill").font(.system(size: 8))
                                    Text("\(abs(stats.rankMove))").font(.caption2.weight(.bold))
                                }
                            }
                            .foregroundStyle(stats.rankMove > 0 ? Palette.brand : Palette.down)
                        }
                    }
                    if active {
                        Card {
                            CardLabel(text: "Flashes")
                            Label("\(stats.flashes)", systemImage: "bolt.fill")
                                .font(.system(size: 18, weight: .black))
                                .foregroundStyle(Palette.text)
                        }
                    } else if let last {
                        Card {
                            CardLabel(text: "Last climb")
                            Text(RelativeDateTimeFormatter.days.localizedString(for: last, relativeTo: Calendar.current.startOfDay(for: .now)))
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(Palette.text)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct LockScreenView: View {
    let stats: ClimbingStats

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("This week").font(.caption2.weight(.semibold))
            Text("\(stats.sends) ") + Text("Sends")
            Label(String(localized: "\(stats.streak) weeks in a row"), systemImage: "flame.fill").font(.caption2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension RelativeDateTimeFormatter {
    // "yesterday", "3 days ago"
    static let days: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .named
        formatter.unitsStyle = .full
        return formatter
    }()
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }

    // Route hold colours are "#RRGGBB"; anything else is drawn grey like on the site (shared/utils/color.ts).
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        let value = digits.count >= 6 ? UInt32(digits.prefix(6), radix: 16) : nil
        self.init(UIColor(rgb: value ?? 0x9E9E9E))
    }
}

private extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
}
