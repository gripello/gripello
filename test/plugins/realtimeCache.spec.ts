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

async function startPlugin(
    data: Record<string, unknown>,
    queries: Record<string, unknown> = {},
) {
    useState('live-key-queries', () => queries)
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

    it('keeps the routes list in line with its filter', async () => {
        const kept = { id: 'r1', gym: 'g1', name: 'A', type: 'Boulder' }
        const app = await startPlugin(
            { 'routes-list': { items: [kept], totalItems: 1 } },
            { 'routes-list': { type: 'Boulder' } },
        )
        emit('gym_changes:g1', {
            collection: 'routes',
            action: 'update',
            record: { ...kept, type: 'Route' },
        })
        expect(app.payload.data['routes-list']).toEqual({
            items: [],
            totalItems: 0,
        })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).not.toHaveBeenCalled()

        emit('gym_changes:g1', {
            collection: 'routes',
            action: 'update',
            record: { id: 'r2', gym: 'g1', name: 'B', type: 'Boulder' },
        })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).toHaveBeenCalledWith('routes-list')
    })

    it('adds and drops map highlights as routes start or stop matching', async () => {
        const app = await startPlugin(
            { 'map-matching': [{ id: 'r1' }] },
            { 'map-matching': { grade: ['6a'], location: 'l1' } },
        )
        const route = { gym: 'g1', name: 'x', location: 'l1' }
        emit('gym_changes:g1', {
            collection: 'routes',
            action: 'update',
            record: { ...route, id: 'r2', grade: '6a' },
        })
        emit('gym_changes:g1', {
            collection: 'routes',
            action: 'update',
            record: { ...route, id: 'r1', grade: '7a' },
        })
        expect(app.payload.data['map-matching']).toEqual([{ id: 'r2' }])
    })

    it('reloads own achievements after a tick and an earned badge', async () => {
        await startPlugin({ 'achievements:me': [], logbook: [] })
        emit('own_ticks', { action: 'create', record: { user: 'me' } })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).toHaveBeenCalledWith(['logbook'])
        expect(refreshNuxtData).toHaveBeenCalledWith('achievements:me')

        refreshNuxtData.mockClear()
        emit('own_notifications', {
            action: 'create',
            record: { type: 'achievement_earned' },
        })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).toHaveBeenCalledWith('achievements:me')
    })

    it('patches the season picker and reloads the shown board', async () => {
        const winter = { id: 's1', gym: 'g1', name: 'Winter' }
        const app = await startPlugin({
            'leaderboard-seasons': [winter],
            leaderboard: {},
        })
        emit('gym_changes:g1', {
            collection: 'seasons',
            action: 'update',
            record: { ...winter, name: 'Spring' },
        })
        expect(app.payload.data['leaderboard-seasons']).toEqual([
            { ...winter, name: 'Spring' },
        ])
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).toHaveBeenCalledWith('leaderboard')
    })

    it('reloads blocks on block events and follows on the rest', async () => {
        await startPlugin({ blocks: [], follows: [] })
        emit('follow_changes', { kind: 'block.created', action: 'create' })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData.mock.calls).toEqual([['blocks']])
    })

    it('reloads only what shows a climber whose profile changed', async () => {
        await startPlugin({
            'climbers:a,b': [],
            'climbers:c': [],
            'ratings:r1': [{ id: 'x', author: { id: 'b' } }],
            'ratings:r2': [{ id: 'y', author: { id: 'c' } }],
            'climber:b': {},
        })
        emit('climbers', { kind: 'climber.updated', id: 'b' })
        await vi.runAllTimersAsync()
        expect(refreshNuxtData).toHaveBeenCalledWith([
            'climbers:a,b',
            'ratings:r1',
            'climber:b',
        ])
    })

    it('takes public settings changes as they come', async () => {
        const app = await startPlugin({
            settings: { allow_registration: true },
        })
        emit('settings', {
            kind: 'settings.updated',
            allow_registration: false,
        })
        expect(app.payload.data.settings).toEqual({
            allow_registration: false,
        })
    })
})
