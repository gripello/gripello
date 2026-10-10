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

function dispatch(event: Event) {
    const { type, data } = event as MessageEvent<string>
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
    if (!handlers.size && !connectCallbacks.size) return close()
    const key = topicKey()
    const target = clientId
    if (!target || key === syncedTopics) return
    syncedTopics = key
    try {
        await useApi()(`/realtime/${target}/subscriptions`, {
            method: 'PUT',
            body: { topics: key ? key.split('\n') : [] },
        })
    } catch (error) {
        if (target === clientId) syncedTopics = null
        console.error('Realtime subscription failed:', error)
        return
    }
    if (target !== clientId || connected) return
    connected = true
    const afterDrop = droppedSinceConnect
    droppedSinceConnect = false
    for (const callback of [...connectCallbacks]) callback(afterDrop)
}

function open() {
    if (source || import.meta.server) return
    const client = useAuthStore()
    const auth = useAuthState(client)
    if (watchedClient !== client) {
        watchedClient = client
        auth.onAuthChange((token) => {
            if (source && token !== streamToken) reopen()
        })
    }
    streamToken = auth.token()
    const stream = new EventSource(apiUrl('/realtime'), {
        withCredentials: true,
    })
    source = stream
    stream.addEventListener('connect', (event) => {
        clientId = JSON.parse((event as MessageEvent<string>).data).clientId
        connected = false
        syncedTopics = null
        void syncTopics()
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

export function onConnect(
    callback: (afterDrop: boolean) => void,
): () => void {
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

export function useRealtime<T = any>(
    topic: MaybeRefOrGetter<string | null | undefined>,
    handler: RealtimeHandler<T>,
    options: { onReactivate?: () => void } = {},
) {
    let active = true
    let missedWhileInactive = false
    let stop: (() => void) | undefined

    onMounted(() => {
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
        options.onReactivate?.()
    })

    onBeforeUnmount(() => {
        stop?.()
        stop = undefined
    })
}
