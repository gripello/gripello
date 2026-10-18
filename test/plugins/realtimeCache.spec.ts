import { ref } from 'vue'

const topics: Record<string, (payload: unknown) => void> = {}

vi.mock('~/composables/useRealtime', () => ({
    subscribeRealtime: (topic: string, handler: (payload: unknown) => void) => {
        topics[topic] = handler
        return () => delete topics[topic]
    },
    onConnect: () => () => {},
    isRealtimeConnected: () => true,
}))
vi.mock('~/api/routes', () => ({ listRoutes: vi.fn() }))

const refreshNuxtData = vi.fn(async (_keys?: string | string[]) => {})

async function startPlugin(data: Record<string, unknown>) {
    vi.stubGlobal('defineNuxtPlugin', (setup: unknown) => setup)
    vi.stubGlobal('useGym', () => ({ id: ref('g1') }))
    vi.stubGlobal('useAuthStore', () => ({ record: { id: 'me' } }))
    vi.stubGlobal('refreshNuxtData', refreshNuxtData)
    const nuxtApp = {
        payload: { data },
        _asyncData: {},
        hook: (name: string, callback: () => void) => {
            if (name === 'app:mounted') callback()
        },
    }
    const { default: plugin } = await import('~/plugins/realtime-cache.client')
    ;(plugin as unknown as (app: typeof nuxtApp) => unknown)(nuxtApp)
    return nuxtApp
}

function emit(topic: string, payload: unknown) {
    topics[topic]!(payload)
}

describe('realtime cache plugin', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.resetModules()
        refreshNuxtData.mockClear()
        for (const topic of Object.keys(topics)) delete topics[topic]
    })
    afterEach(() => vi.useRealTimers())

    it('empties the open route when it is deleted', async () => {
        const app = await startPlugin({ 'route:r1': { id: 'r1', gym: 'g1' } })
        emit('gym_changes:g1', {
            collection: 'routes',
            action: 'delete',
            record: { id: 'r1', gym: 'g1' },
        })
        expect(app.payload.data['route:r1']).toBeNull()
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).not.toHaveBeenCalledWith('route:r1')
    })

    it('refetches the open route once per burst of updates', async () => {
        await startPlugin({ 'route:r1': { id: 'r1', gym: 'g1' } })
        for (let i = 0; i < 3; i++)
            emit('gym_changes:g1', {
                collection: 'routes',
                action: 'update',
                record: { id: 'r1', gym: 'g1', name: `v${i}` },
            })
        await vi.runAllTimersAsync()
        expect(
            refreshNuxtData.mock.calls.filter(([key]) => key === 'route:r1'),
        ).toHaveLength(1)
    })

    it('reloads follows before the views that read them', async () => {
        await startPlugin({
            follows: [],
            'climber:c1': {},
            'climber-ticks:c1': [],
        })
        emit('follow_changes', { action: 'update', record: {} })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData.mock.calls).toEqual([
            [['follows', 'climber:c1']],
            [['climber-ticks:c1']],
        ])
    })

    it('adds and removes beta videos of an open route', async () => {
        const app = await startPlugin({
            'beta-videos:r1': [{ id: 'b1', gym: 'g1', route: 'r1' }],
        })
        const beta = { id: 'b2', gym: 'g1', route: 'r1' }
        emit('gym_changes:g1', {
            collection: 'beta_videos',
            action: 'create',
            record: beta,
        })
        expect(app.payload.data['beta-videos:r1']).toEqual([
            beta,
            { id: 'b1', gym: 'g1', route: 'r1' },
        ])
        emit('gym_changes:g1', {
            collection: 'beta_videos',
            action: 'delete',
            record: { id: 'b1', gym: 'g1', route: 'r1' },
        })
        expect(app.payload.data['beta-videos:r1']).toEqual([beta])
    })
})
