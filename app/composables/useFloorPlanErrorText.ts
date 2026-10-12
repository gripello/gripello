import type { FloorPlanError } from '~/utils/mapEditor'

const REASONS: Record<string, string> = {
    validation_not_unique: 'mapEditor.missing.duplicate',
    validation_required: 'mapEditor.missing.name',
    validation_wall_has_routes: 'mapEditor.stillHasRoutes',
    validation_invalid_outline: 'mapEditor.missing.outline',
    validation_invalid_edge: 'mapEditor.missing.edge',
}

export function useFloorPlanErrorText() {
    const { t } = useI18n()
    return (error: FloorPlanError) =>
        REASONS[error.code] ? t(REASONS[error.code]!) : error.message
}
