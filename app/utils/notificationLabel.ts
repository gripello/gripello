export function notificationLabelKey(item: {
    type: string
    params?: Record<string, unknown> | null
}) {
    const withGym = item.type === 'task_defect_filed' && !!item.params?.gym
    return `notifications.center.types.${item.type}${withGym ? '_gym' : ''}`
}
