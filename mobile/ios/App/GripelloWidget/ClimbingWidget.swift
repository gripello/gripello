import SwiftUI
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

    private func entry(for configuration: ClimbingWidgetIntent) async -> ClimbingEntry {
        ClimbingEntry(date: .now, state: await WidgetAPI.load(gym: configuration.gym?.id), gymName: configuration.gym?.name)
    }
}

struct ClimbingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "app.gripello.climbing", intent: ClimbingWidgetIntent.self, provider: ClimbingProvider()) { entry in
            ClimbingWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("My climbing")
        .description("Your sends this week, your streak and your latest climbs.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

@main
struct GripelloWidgetBundle: WidgetBundle {
    var body: some Widget { ClimbingWidget() }
}

private let brand = Color(red: 0x4A / 255, green: 0x9B / 255, blue: 0x2F / 255)

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
                case .systemMedium: MediumView(stats: stats, gymName: entry.gymName)
                default: SmallView(stats: stats, gymName: entry.gymName)
                }
            }
            .widgetURL(URL(string: stats.origin + "/logbook"))
        }
    }
}

private struct SignedOutView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "figure.climbing").font(.title2).foregroundStyle(brand)
            Text("Sign in to Gripello to see your climbing.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct WeekSummary: View {
    let stats: ClimbingStats
    let gymName: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(gymName ?? String(localized: "This week"))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if stats.unread > 0 {
                    Label("\(stats.unread)", systemImage: "bell.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(brand)
                        .labelStyle(.titleAndIcon)
                }
            }
            Text("\(stats.sends)")
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            Text("Sends").font(.caption.weight(.medium))
            Spacer(minLength: 4)
            if stats.flashes > 0 {
                Label(String(localized: "Flashes: \(stats.flashes)"), systemImage: "bolt.fill")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Label(String(localized: "\(stats.streak) weeks in a row"), systemImage: "flame.fill")
                .font(.caption2)
                .foregroundStyle(stats.streak > 0 ? .orange : .secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct SmallView: View {
    let stats: ClimbingStats
    let gymName: String?
    var body: some View { WeekSummary(stats: stats, gymName: gymName) }
}

private struct MediumView: View {
    let stats: ClimbingStats
    let gymName: String?

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            WeekSummary(stats: stats, gymName: gymName)
            VStack(alignment: .leading, spacing: 6) {
                if let hardest = stats.hardest {
                    Text(String(localized: "Hardest \(hardest.grade)"))
                        .font(.caption.weight(.semibold))
                }
                Text("Latest sends")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                if stats.latest.isEmpty {
                    Text("No sends this week yet")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(stats.latest, id: \.self) { send in
                    SendRow(send: send)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

private struct SendRow: View {
    let send: ClimbingStats.Send

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color(hex: send.color))
                .overlay(Circle().strokeBorder(.primary.opacity(0.15)))
                .frame(width: 10, height: 10)
            Text(send.grade).font(.caption.weight(.semibold)).monospacedDigit()
            Text(send.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            if send.flash {
                Image(systemName: "bolt.fill").font(.caption2).foregroundStyle(brand)
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

private extension Color {
    // Route hold colours are "#RRGGBB"; anything else is drawn grey like on the site (shared/utils/color.ts).
    init(hex: String) {
        let digits = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        let value = digits.count >= 6 ? UInt32(digits.prefix(6), radix: 16) : nil
        let rgb = value ?? 0x9E9E9E
        self.init(red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }
}
