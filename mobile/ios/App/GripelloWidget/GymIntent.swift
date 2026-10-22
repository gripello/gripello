import AppIntents
import WidgetKit

// Long-press → Edit Widget: narrow the numbers to one gym, or keep all gyms (no gym picked).
struct GymEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Gym"
    static let defaultQuery = GymQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct GymQuery: EntityQuery {
    func entities(for identifiers: [GymEntity.ID]) async throws -> [GymEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [GymEntity] {
        try await WidgetAPI.gyms().map { GymEntity(id: $0.id, name: $0.name) }
    }
}

struct ClimbingWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Gym"
    static let description = IntentDescription("Leave empty for all gyms.")

    @Parameter(title: "Gym")
    var gym: GymEntity?
}

// "My gym" shows one gym; until one is picked it asks for it.
struct GymWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Gym"
    static let description = IntentDescription("The gym this widget shows.")

    @Parameter(title: "Gym")
    var gym: GymEntity?
}
