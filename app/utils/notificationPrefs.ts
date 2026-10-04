export type NotificationChannel = 'push'
export type NotificationPrefs = Partial<
    Record<NotificationChannel, Record<string, boolean>>
>

export interface NotificationTopic {
    key: string
    permission?: string
}

export function visibleTopics<T extends NotificationTopic>(
    topics: T[],
    grantedPermissions: ReadonlySet<string>,
): T[] {
    return topics.filter(
        (topic) =>
            !topic.permission || grantedPermissions.has(topic.permission),
    )
}

export function isTopicEnabled(
    prefs: NotificationPrefs | null | undefined,
    channel: NotificationChannel,
    topic: string,
) {
    return prefs?.[channel]?.[topic] !== false
}

export function withTopic(
    prefs: NotificationPrefs | null | undefined,
    channel: NotificationChannel,
    topic: string,
    enabled: boolean,
): NotificationPrefs {
    const { [topic]: _previous, ...others } = prefs?.[channel] ?? {}
    return {
        ...prefs,
        [channel]: enabled ? others : { ...others, [topic]: false },
    }
}
