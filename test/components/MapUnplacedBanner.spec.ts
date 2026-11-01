import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MapUnplacedBanner from '~/components/map/UnplacedBanner.vue'
import { listLocations, listRoutes, listWalls } from '~/api/routes'

vi.mock('~/api/routes', () => ({
    listLocations: vi.fn(),
    listRoutes: vi.fn(),
    listWalls: vi.fn(),
}))

const plan = {
    width: 10,
    height: 10,
    shapes: [
        {
            kind: 'floor',
            points: [
                [0, 0],
                [10, 0],
                [10, 10],
            ],
        },
    ],
}

beforeEach(() => {
    vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
    vi.stubGlobal('useCurrentGymId', () => ref('g1'))
    vi.mocked(listWalls).mockResolvedValue([
        { id: 'w1', location: 'mapped' },
        { id: 'w2', location: 'unmapped' },
    ] as never)
    vi.mocked(listLocations).mockResolvedValue([
        { id: 'mapped', map: plan },
        { id: 'unmapped', map: null },
    ] as never)
    vi.mocked(listRoutes).mockReset()
})

async function mountBanner() {
    const wrapper = mount(MapUnplacedBanner, {
        global: {
            mocks: {
                $t: (key: string, params?: { n: number }) =>
                    params ? `${key}:${params.n}` : key,
            },
            stubs: {
                UAlert: {
                    template:
                        '<div data-testid="unplaced-banner"><slot name="description" /></div>',
                },
                UButton: {
                    props: ['to'],
                    template:
                        '<a data-testid="unplaced-banner-open" :data-to="JSON.stringify(to)"><slot /></a>',
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

describe('MapUnplacedBanner', () => {
    it('counts wall-less routes only in locations that have a floor plan with walls', async () => {
        vi.mocked(listRoutes).mockResolvedValue({
            items: [
                { id: 'r1', location: 'unmapped' },
                { id: 'r2', location: 'mapped' },
                { id: 'r3', location: 'mapped' },
            ],
        } as never)
        const wrapper = await mountBanner()
        expect(listRoutes).toHaveBeenCalledWith('g1', {
            wall: 'none',
            sort: 'location',
        })
        expect(wrapper.text()).toContain('mapPlacement.unplacedBanner:2')
        expect(
            JSON.parse(
                wrapper
                    .get('[data-testid="unplaced-banner-open"]')
                    .attributes('data-to')!,
            ),
        ).toEqual({ path: '/gym/manage/map', query: { location: 'mapped' } })
    })

    it('stays hidden when every route is placed', async () => {
        vi.mocked(listRoutes).mockResolvedValue({
            items: [{ id: 'r1', location: 'unmapped' }],
        } as never)
        const wrapper = await mountBanner()
        expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(
            false,
        )
    })

    it('skips the route lookup without a mapped location', async () => {
        vi.mocked(listLocations).mockResolvedValue([
            { id: 'mapped', map: null },
        ] as never)
        const wrapper = await mountBanner()
        expect(listRoutes).not.toHaveBeenCalled()
        expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(
            false,
        )
    })
})
