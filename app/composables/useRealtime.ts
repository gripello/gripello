import {
    onActivated,
    onBeforeUnmount,
    onDeactivated,
    onMounted,
    toValue,
    watch,
    type MaybeRefOrGetter,
} from 'vue'
import type { ApiRecord } from '~/composables/authStore'
import type { GymRecord } from '~/types/models'
import { apiUrl, useApi } from '~/api/client'
import { useAuthState } from '~/api/auth'
import { coalesce } from '~/utils/realtimeCache'

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
    GymMemberChange | { kind: 'gym.updated'; record: GymRecord }

export type UserEvent =
    | { kind: 'user.updated'; record: ApiRecord; changed?: string[] }
    | { kind: 'user.deleted'; id: string }

const handlers = new Map<string, Set<(payload: unknown) => void>>()
const connectCallbacks = new Set<(afterDrop: boolean) => void>()
let source: EventSource | null = null
let clientId = ''
let connected = false
let droppedSinceConnect = false
let syncedTopics: string | null = null
let syncTimer: ReturnType<typeof setTimeout> | undefined
let streamToken: string | undefined
let watchedClient: unknown
let lastEventId = ''
let replaySince = ''

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

async function syncTopics() {
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
        if (target === clientId) syncedTopics = null
        replaySince ||= since
        console.error('Realtime subscription failed:', error)
        return
    }
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
    useRealtime<T>(
        topic,
        (payload) => {
            if (!options.when || options.when(payload)) soon()
        },
        { resync: soon },
    )
    return soon
}
