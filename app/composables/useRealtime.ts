import {
    onActivated,
    onBeforeUnmount,
    onDeactivated,
    onMounted,
    onScopeDispose,
    toValue,
    watch,
    type MaybeRefOrGetter,
} from 'vue'
import type { ApiRecord } from '~/composables/authStore'
import type { GymRecord } from '~/types/models'
import { apiUrl, useApi } from '~/api/client'
import { useAuthState } from '~/api/auth'
import { coalesce } from '~/utils/realtimeCache'
import { useAuthRecord } from '~/composables/useAuthRecord'

export type RealtimeHandler<T = any> = (payload: T) => unknown

export interface RecordChange<T = any> {
    action: 'create' | 'update' | 'delete'
    record: T
}

export interface GymMemberChange {
    kind: 'membership.changed' | 'role.changed' | 'invite.changed'
    action: RecordChange['action']
    id: string
    gym: string
    users?: string[]
    role?: string
}

export type GymEvent =
    | GymMemberChange
    | { kind: 'gym.updated'; record: GymRecord }
    | { kind: 'gym.trial_changed'; gym: string; trial_ends_at: string | null }

export type AccountPart = 'mfa' | 'sessions' | 'identities'

export type UserEvent =
    | { kind: 'user.updated'; record: ApiRecord; changed?: string[] }
    | { kind: 'user.deleted'; id: string }
    | { kind: 'account.changed'; changed: AccountPart[] }

const handlers = new Map<string, Set<(payload: unknown) => void>>()
const connectCallbacks = new Set<(afterDrop: boolean) => void>()
let source: EventSource | null = null
let clientId = ''
let connected = false
let droppedSinceConnect = false
let syncedTopics: string | null = null
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncInFlight: Promise<void> | null = null
let syncAgain = false
let syncRetryMs = 0
let streamToken: string | undefined
let watchedClient: unknown
let lastEventId = ''
let replaySince = ''
let watchingVisibility = false
let hiddenAt = 0

// A suspended app (or background tab) can lose the stream without an error event, so a long absence reconnects.
const RESUME_RECONNECT_MS = 30_000

function watchVisibility() {
    if (watchingVisibility) return
    watchingVisibility = true
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden')
            return void (hiddenAt = Date.now())
        const away = hiddenAt ? Date.now() - hiddenAt : 0
        hiddenAt = 0
        if (!source) return
        if (
            away <= RESUME_RECONNECT_MS &&
            source.readyState !== EventSource.CLOSED
        )
            return
        droppedSinceConnect = true
        reopen()
    })
}

function dispatch(event: Event) {
    const { type, data } = event as MessageEvent<string>
    if ((event as MessageEvent).lastEventId)
        lastEventId = (event as MessageEvent).lastEventId
    let payload: unknown
    try {
        payload = JSON.parse(data)
    } catch {
        return
    }
    for (const handler of handlers.get(type) ?? []) handler(payload)
}

function topicKey() {
    return [...handlers.keys()].sort().join('\n')
}

function scheduleSync() {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(syncTopics, 0)
}

const SYNC_RETRY_MAX_MS = 30_000

// One subscription request at a time, so the server applies them in order; the rerun sends the latest topics.
function syncTopics(): Promise<void> {
    if (syncInFlight) {
        syncAgain = true
        return syncInFlight
    }
    syncInFlight = (async () => {
        do {
            syncAgain = false
            await syncOnce()
        } while (syncAgain)
    })().finally(() => (syncInFlight = null))
    return syncInFlight
}

async function syncOnce() {
    if (!handlers.size && !connectCallbacks.size) {
        lastEventId = ''
        return close()
    }
    const key = topicKey()
    const target = clientId
    if (!target || key === syncedTopics) return
    syncedTopics = key
    const since = replaySince
    replaySince = ''
    try {
        await useApi()(`/realtime/${target}/subscriptions`, {
            method: 'PUT',
            body: {
                topics: key ? key.split('\n') : [],
                ...(since ? { since: Number(since) } : {}),
            },
        })
    } catch (error) {
        replaySince ||= since
        console.error('Realtime subscription failed:', error)
        if (target !== clientId) return
        const { status = 0 } = (error as { status?: number } | null) ?? {}
        // a refused topic set is only sent again once the topics or the stream change
        if (status && status !== 429 && status < 500) return
        syncedTopics = null
        syncRetryMs = Math.min(SYNC_RETRY_MAX_MS, syncRetryMs * 2 || 1000)
        clearTimeout(syncTimer)
        syncTimer = setTimeout(syncTopics, syncRetryMs)
        return
    }
    syncRetryMs = 0
    if (target !== clientId || connected) return
    connected = true
    // the server replays a dropped stream after its last event id; only a stream that never got one has a gap
    const afterDrop = droppedSinceConnect && !lastEventId
    droppedSinceConnect = false
    notifyConnect(afterDrop)
}

function notifyConnect(afterDrop: boolean) {
    for (const callback of [...connectCallbacks]) callback(afterDrop)
}

// The stream's principal comes from the subscription request, so a new token only needs a new one;
// since replays what the previous principal wasn't allowed to receive.
function resubscribe() {
    syncedTopics = null
    replaySince = lastEventId
    scheduleSync()
}

function open() {
    if (source || import.meta.server) return
    watchVisibility()
    const client = useAuthStore()
    const auth = useAuthState(client)
    if (watchedClient !== client) {
        watchedClient = client
        auth.onAuthChange((token) => {
            if (!source || token === streamToken) return
            streamToken = token
            resubscribe()
        })
    }
    streamToken = auth.token()
    const query = lastEventId
        ? `?lastEventId=${encodeURIComponent(lastEventId)}`
        : ''
    const stream = new EventSource(apiUrl('/realtime') + query, {
        withCredentials: true,
    })
    source = stream
    stream.addEventListener('connect', (event) => {
        clientId = JSON.parse((event as MessageEvent<string>).data).clientId
        connected = false
        syncRetryMs = 0
        syncedTopics = null
        void syncTopics()
    })
    // the replay couldn't cover the gap: everything live reloads
    stream.addEventListener('resync', (event) => {
        if ((event as MessageEvent).lastEventId)
            lastEventId = (event as MessageEvent).lastEventId
        notifyConnect(true)
    })
    stream.addEventListener('error', () => {
        if (clientId) droppedSinceConnect = true
        connected = false
        clientId = ''
        if (stream.readyState === EventSource.CLOSED)
            setTimeout(
                () => source === stream && reopen(),
                1000 + Math.random() * 4000,
            )
    })
    for (const topic of handlers.keys())
        stream.addEventListener(topic, dispatch)
}

function close() {
    source?.close()
    source = null
    clientId = ''
    connected = false
    syncedTopics = null
}

function reopen() {
    close()
    open()
}

export function subscribeRealtime<T = any>(
    topic: string,
    handler: RealtimeHandler<T>,
): () => void {
    let closed = false
    const listener = (payload: unknown) => {
        if (!closed) void handler(payload as T)
    }
    const listeners = handlers.get(topic) ?? new Set()
    if (!listeners.size) source?.addEventListener(topic, dispatch)
    handlers.set(topic, listeners.add(listener))
    open()
    scheduleSync()
    return () => {
        if (closed) return
        closed = true
        listeners.delete(listener)
        if (listeners.size) return
        handlers.delete(topic)
        source?.removeEventListener(topic, dispatch)
        scheduleSync()
    }
}

export function onConnect(callback: (afterDrop: boolean) => void): () => void {
    const wrapped = (afterDrop: boolean) => callback(afterDrop)
    connectCallbacks.add(wrapped)
    open()
    return () => {
        connectCallbacks.delete(wrapped)
        scheduleSync()
    }
}

export function isRealtimeConnected() {
    return connected
}

// resync reloads what the handler patches, after events it couldn't see: while kept alive, or lost in a gap the server couldn't replay
export function useRealtime<T = any>(
    topic: MaybeRefOrGetter<string | null | undefined>,
    handler: RealtimeHandler<T>,
    options: { resync?: () => void } = {},
) {
    let active = true
    let missedWhileInactive = false
    let stop: (() => void) | undefined
    let stopResync: (() => void) | undefined

    onMounted(() => {
        const { resync } = options
        if (resync)
            stopResync = onConnect((afterDrop) => {
                if (!afterDrop) return
                if (active) resync()
                else missedWhileInactive = true
            })
        watch(
            () => toValue(topic),
            (next) => {
                stop?.()
                stop = next
                    ? subscribeRealtime<T>(next, (payload) => {
                          if (active) return handler(payload)
                          missedWhileInactive = true
                      })
                    : undefined
            },
            { immediate: true },
        )
    })

    onDeactivated(() => {
        active = false
    })

    onActivated(() => {
        active = true
        if (!missedWhileInactive) return
        missedWhileInactive = false
        options.resync?.()
    })

    onBeforeUnmount(() => {
        stop?.()
        stop = undefined
        stopResync?.()
    })
}

// Reloads through refresh, coalesced, on matching events and after a gap the server couldn't replay.
export function useLiveRefresh<T = any>(
    topic: MaybeRefOrGetter<string | null | undefined>,
    refresh: () => Promise<unknown>,
    options: { when?: (payload: T) => boolean; delayMs?: number } = {},
) {
    const soon = coalesce(refresh, options.delayMs)
    onScopeDispose(soon.cancel)
    useRealtime<T>(
        topic,
        (payload) => {
            if (!options.when || options.when(payload)) soon()
        },
        { resync: soon },
    )
    return soon
}

// Security lists (2FA, sessions, linked accounts) reload when another device of the user changes them.
export function useAccountChanges(
    part: AccountPart,
    reload: () => Promise<unknown>,
) {
    const authRecord = useAuthRecord()
    return useLiveRefresh(
        () => authRecord.value?.id && `user:${authRecord.value.id}`,
        reload,
        {
            when: (event: UserEvent) =>
                event.kind === 'account.changed' &&
                event.changed.includes(part),
            delayMs: 300,
        },
    )
}
