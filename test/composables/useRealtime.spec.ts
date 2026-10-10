import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
    isRealtimeConnected,
    onConnect,
    subscribeRealtime,
    useRealtime,
} from '~/composables/useRealtime'
import { useAuthState } from '~/api/auth'
import { mockApi } from '../api/apiMock'

class FakeEventSource extends EventTarget {
    static readonly CLOSED = 2
    static instances: FakeEventSource[] = []
    readyState = 1

    constructor(
        readonly url: string,
        readonly init?: EventSourceInit,
    ) {
        super()
        FakeEventSource.instances.push(this)
    }

    close() {
        this.readyState = FakeEventSource.CLOSED
    }

    emit(type: string, data: unknown) {
        this.dispatchEvent(
            new MessageEvent(type, { data: JSON.stringify(data) }),
        )
    }
}

const token = `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y`

let api: ReturnType<typeof mockApi>
let stops: (() => void)[]

const stream = () => FakeEventSource.instances.at(-1)!
const subscriptionCalls = () =>
    api.fetchMock.mock.calls
        .map((_, index) => api.request(index))
        .filter((call) => call.method === 'PUT')

function track(stop: () => void) {
    stops.push(stop)
    return stop
}

async function connect(clientId = 'c1') {
    stream().emit('connect', { clientId })
    await vi.waitFor(() =>
        expect(
            subscriptionCalls().some((call) => call.url.includes(clientId)),
        ).toBe(true),
    )
}

beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
    api = mockApi()
    stops = []
})

afterEach(async () => {
    for (const stop of stops) stop()
    await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('subscribeRealtime', () => {
    it('opens one stream and subscribes the topic set once connected', async () => {
        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        const ticks = vi.fn()
        const gym = vi.fn()
        track(subscribeRealtime('own_ticks', ticks))
        track(subscribeRealtime('gym_changes:g1', gym))
        expect(FakeEventSource.instances).toHaveLength(1)
        expect(stream().url).toBe('/api/realtime')
        expect(stream().init).toEqual({ withCredentials: true })

        await connect()
        const [put] = subscriptionCalls()
        expect(put).toMatchObject({
            url: '/api/realtime/c1/subscriptions',
            body: { topics: ['gym_changes:g1', 'own_ticks'] },
        })
        expect(put!.headers.get('Authorization')).toBe(`Bearer ${token}`)

        stream().emit('own_ticks', { kind: 'tick.created', action: 'create' })
        expect(ticks).toHaveBeenCalledWith({
            kind: 'tick.created',
            action: 'create',
        })
        expect(gym).not.toHaveBeenCalled()
    })

    it('reports the connection after the subscription and on every reconnect', async () => {
        const connected = vi.fn()
        track(onConnect(connected))
        track(subscribeRealtime('own_ticks', vi.fn()))
        expect(isRealtimeConnected()).toBe(false)
        await connect('c1')
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(1))
        expect(isRealtimeConnected()).toBe(true)

        await connect('c2')
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2))
        expect(subscriptionCalls().at(-1)!.url).toContain('/realtime/c2/')
    })

    it('tells connect callbacks whether the stream dropped or was reopened for a new token', async () => {
        const connected = vi.fn()
        track(onConnect(connected))
        track(subscribeRealtime('own_ticks', vi.fn()))
        await connect('c1')
        await vi.waitFor(() => expect(connected).toHaveBeenLastCalledWith(false))

        useAuthState().saveAuth({ token, record: { id: 'u1' } as never })
        await connect('c2')
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(2))
        expect(connected).toHaveBeenLastCalledWith(false)

        stream().dispatchEvent(new Event('error'))
        await connect('c3')
        await vi.waitFor(() => expect(connected).toHaveBeenCalledTimes(3))
        expect(connected).toHaveBeenLastCalledWith(true)
        useAuthState().clearAuth()
    })

    it('updates the topics when they change and closes when none are left', async () => {
        const stop = subscribeRealtime('own_ticks', vi.fn())
        await connect()
        const stopGym = subscribeRealtime('gym:g1', vi.fn())
        await vi.waitFor(() => expect(subscriptionCalls()).toHaveLength(2))
        expect(subscriptionCalls()[1]!.body).toEqual({
            topics: ['gym:g1', 'own_ticks'],
        })

        const handler = vi.fn()
        track(subscribeRealtime('gym:g1', handler))
        stopGym()
        stream().emit('gym:g1', { kind: 'gym.updated' })
        expect(handler).toHaveBeenCalledTimes(1)

        stops.pop()!()
        stop()
        await vi.waitFor(() =>
            expect(stream().readyState).toBe(FakeEventSource.CLOSED),
        )
    })

    it('reopens the stream when the token changes, not on profile saves', async () => {
        const auth = useAuthState()
        auth.saveAuth({ token, record: { id: 'u1' } as never })
        track(subscribeRealtime('own_ticks', vi.fn()))
        await connect()
        auth.saveUser({ id: 'u1', name: 'Ann' } as never)
        expect(FakeEventSource.instances).toHaveLength(1)

        auth.clearAuth()
        expect(FakeEventSource.instances).toHaveLength(2)
        expect(FakeEventSource.instances[0]!.readyState).toBe(
            FakeEventSource.CLOSED,
        )
        await connect('c2')
        expect(subscriptionCalls().at(-1)!.headers.has('Authorization')).toBe(
            false,
        )
    })
})

describe('useRealtime', () => {
    it('subscribes on mount, follows the topic and releases on unmount', async () => {
        const topic = ref('own_ticks')
        const handler = vi.fn()
        const wrapper = mount(
            defineComponent({
                setup() {
                    useRealtime(topic, handler)
                    return () => h('div')
                },
            }),
        )
        stream().emit('own_ticks', { action: 'create' })
        expect(handler).toHaveBeenCalledTimes(1)

        topic.value = 'followed_ticks'
        await nextTick()
        stream().emit('own_ticks', { action: 'create' })
        stream().emit('followed_ticks', { action: 'create' })
        expect(handler).toHaveBeenCalledTimes(2)

        wrapper.unmount()
        stream().emit('followed_ticks', { action: 'create' })
        expect(handler).toHaveBeenCalledTimes(2)
    })

    it('drops events while deactivated and reloads once on activate', async () => {
        const onEvent = vi.fn()
        const onReactivate = vi.fn()
        const show = ref(true)
        const Child = defineComponent({
            setup() {
                useRealtime('gym_changes:g1', onEvent, { onReactivate })
                return () => h('div')
            },
        })
        const wrapper = mount(
            defineComponent({
                setup: () => () =>
                    h(KeepAlive, null, [show.value ? h(Child) : null]),
            }),
        )

        stream().emit('gym_changes:g1', { action: 'update' })
        expect(onEvent).toHaveBeenCalledTimes(1)

        show.value = false
        await nextTick()
        stream().emit('gym_changes:g1', { action: 'update' })
        expect(onEvent).toHaveBeenCalledTimes(1)
        expect(onReactivate).not.toHaveBeenCalled()

        show.value = true
        await nextTick()
        expect(onReactivate).toHaveBeenCalledTimes(1)

        show.value = false
        await nextTick()
        show.value = true
        await nextTick()
        expect(onReactivate).toHaveBeenCalledTimes(1)
        wrapper.unmount()
    })
})
