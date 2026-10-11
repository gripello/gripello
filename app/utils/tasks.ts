import type {
    DefectCategory,
    OpenRouteDefectRecord,
    TaskPriorityName,
    TaskRecord,
    TaskStatus,
} from '~/types/models'

export const TASK_KINDS = [
    'defect',
    'wish',
    'reset',
    'maintenance',
    'other',
] as const

export const STAFF_TASK_KINDS = ['reset', 'maintenance', 'other'] as const

export const DEFECT_CATEGORIES = [
    'loose_bolt',
    'loose_hold',
    'spinning_hold',
    'broken_hold',
    'damaged_volume',
    'sharp_edge',
    'missing_hold',
    'label_tag',
    'other',
] as const

export const DEFECT_CATEGORY_ICONS: Record<DefectCategory, string> = {
    loose_bolt: 'i-lucide-wrench',
    loose_hold: 'i-lucide-move',
    spinning_hold: 'i-lucide-rotate-cw',
    broken_hold: 'i-lucide-hammer',
    damaged_volume: 'i-lucide-box',
    sharp_edge: 'i-lucide-triangle-alert',
    missing_hold: 'i-lucide-circle-dashed',
    label_tag: 'i-lucide-tag',
    other: 'i-lucide-circle-help',
}

export const URGENT_DEFECT_CATEGORIES: readonly DefectCategory[] = [
    'loose_bolt',
    'loose_hold',
    'spinning_hold',
    'broken_hold',
]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export const NORMAL_TASK_PRIORITY = 2

export const URGENT_TASK_PRIORITY = 4

export function taskPriorityName(priority: number): TaskPriorityName {
    return TASK_PRIORITIES[priority - 1] ?? 'normal'
}

export function taskPriorityLevel(name: TaskPriorityName): number {
    return TASK_PRIORITIES.indexOf(name) + 1
}

export const TASK_STATUSES = [
    'open',
    'in_progress',
    'waiting',
    'done',
    'dismissed',
] as const

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
    open: 'i-lucide-circle-dashed',
    in_progress: 'i-lucide-circle-play',
    waiting: 'i-lucide-hourglass',
    done: 'i-lucide-circle-check',
    dismissed: 'i-lucide-circle-x',
}

export const BOARD_STATUSES = [
    'open',
    'in_progress',
    'waiting',
    'done',
] as const

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
    'open',
    'in_progress',
    'waiting',
]

const DAY_MS = 24 * 60 * 60 * 1000

export type TaskAgeLevel = 'fresh' | 'aging' | 'stale'

export function taskAge(
    task: Pick<TaskRecord, 'created' | 'kind' | 'priority'>,
    now = new Date(),
): { days: number; level: TaskAgeLevel } {
    const days = task.created
        ? Math.max(
              0,
              Math.floor(
                  (now.getTime() - new Date(task.created).getTime()) / DAY_MS,
              ),
          )
        : 0
    const [aging, stale] =
        task.kind === 'defect' && task.priority === URGENT_TASK_PRIORITY
            ? [1, 2]
            : [7, 14]
    const level = days >= stale ? 'stale' : days >= aging ? 'aging' : 'fresh'
    return { days, level }
}

export function isUrgentDefect(category?: string | null): boolean {
    return URGENT_DEFECT_CATEGORIES.includes(category as DefectCategory)
}

export function isTaskActive(status: TaskStatus): boolean {
    return ACTIVE_TASK_STATUSES.includes(status)
}

export function isTaskOverdue(
    task: Pick<TaskRecord, 'due_date' | 'status'>,
    now = new Date(),
): boolean {
    if (!task.due_date || !isTaskActive(task.status)) return false
    const due = new Date(task.due_date)
    due.setHours(23, 59, 59, 999)
    return due < now
}

export function taskPriorityColor(
    priority: number,
): 'error' | 'warning' | 'neutral' | 'info' {
    const name = taskPriorityName(priority)
    if (name === 'urgent') return 'error'
    if (name === 'high') return 'warning'
    if (name === 'low') return 'neutral'
    return 'info'
}

export function taskStatusColor(
    status: TaskStatus,
): 'warning' | 'info' | 'secondary' | 'success' | 'neutral' {
    if (status === 'open') return 'warning'
    if (status === 'in_progress') return 'info'
    if (status === 'waiting') return 'secondary'
    if (status === 'done') return 'success'
    return 'neutral'
}

export function taskTitle(
    task: Pick<TaskRecord, 'kind' | 'title' | 'category'> &
        Partial<Pick<TaskRecord, 'route_type' | 'grade'>>,
    t: (key: string) => string,
): string {
    if (task.title) return task.title
    if (task.kind === 'wish' && task.route_type)
        return [t(`routes.types.${task.route_type.toLowerCase()}`), task.grade]
            .filter(Boolean)
            .join(' ')
    if (task.kind === 'defect' && task.category)
        return t(`tasks.categories.${task.category}`)
    return t(`tasks.kinds.${task.kind}`)
}

export type DefectSeverity = 'urgent' | 'minor'

export function defectSeverityByRoute(
    defects: readonly Pick<OpenRouteDefectRecord, 'route' | 'category'>[],
): Map<string, DefectSeverity> {
    const severities = new Map<string, DefectSeverity>()
    for (const defect of defects) {
        if (severities.get(defect.route) === 'urgent') continue
        severities.set(
            defect.route,
            isUrgentDefect(defect.category) ? 'urgent' : 'minor',
        )
    }
    return severities
}
