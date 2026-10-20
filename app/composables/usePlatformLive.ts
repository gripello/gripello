import { liveTopics } from '#shared/utils/topics'
export type PlatformEventKind =
    | 'platform_gyms.changed'
    | 'platform_users.changed'
    | 'platform_config.updated'
    | 'oauth2_provider.updated'
    | 'retired_slug.deleted'
    | 'backup.created'
    | 'backup.deleted'
    | 'backup.updated'

export interface PlatformEvent {
    kind: PlatformEventKind
    id?: string
    changed?: string[] | null
}

// Platform pages reload when another admin (or anyone, for gyms and users) changes what they list.
export function usePlatformLive(
    kinds: PlatformEventKind[],
    refresh: () => Promise<unknown>,
) {
    return useLiveRefresh(liveTopics.platform, refresh, {
        when: (event: PlatformEvent) => kinds.includes(event.kind),
    })
}
