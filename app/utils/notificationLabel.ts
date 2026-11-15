type NotificationItem = {
    type: string
    params?: Record<string, unknown> | null
}

export function notificationLabelKey(item: NotificationItem) {
    const withGym = item.type === 'task_defect_filed' && !!item.params?.gym
    const more =
        item.type === 'achievement_earned' && Number(item.params?.count) > 1
    return `notifications.center.types.${item.type}${withGym ? '_gym' : ''}${more ? '_more' : ''}`
}

export function notificationLabel(
    item: NotificationItem,
    t: (key: string, params?: Record<string, unknown>) => string,
    te: (key: string) => boolean,
) {
    const params = item.params ?? {}
    if (item.type !== 'achievement_earned')
        return t(notificationLabelKey(item), params)
    if (!te(`achievements.names.${params.key}`))
        return t('notifications.center.types.achievement_earned_unnamed', {
            count: params.count,
        })
    return t(notificationLabelKey(item), {
        name: t(`achievements.names.${params.key}`),
        more: Number(params.count) - 1,
    })
}
