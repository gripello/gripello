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

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export const TASK_STATUSES = [
    'open',
    'in_progress',
    'waiting',
    'done',
    'dismissed',
] as const
