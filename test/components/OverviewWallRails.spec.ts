import { mount } from '@vue/test-utils'
import WallRails from '~/components/overview/WallRails.vue'

const route = (id: string, patch: Record<string, unknown>) => ({
    id,
    name: id,
    creator: [],
    ...patch,
})

function createWrapper(walls: unknown[]) {
    return mount(WallRails, {
        props: { walls, now: new Date('2026-09-27T12:00:00Z') } as never,
        global: {
            mocks: {
                $t: (key: string, params?: { n?: number }) =>
                    `${key}:${params?.n ?? ''}`,
            },
            stubs: {
                NuxtLink: { template: '<a><slot /></a>' },
                UBadge: {
                    props: ['label'],
                    template: '<span>{{ label }}</span>',
                },
                UIcon: true,
            },
        },
    })
}

describe('OverviewWallRails', () => {
    beforeEach(() => {
        vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
        vi.stubGlobal('useGradeSystems', () => ({
            routeGradeSystem: computed(() => 'uiaa'),
            boulderGradeSystem: computed(() => 'font'),
        }))
    })

    it('draws a rail per route type the gym has and stacks equal grades', () => {
        const wrapper = createWrapper([
            {
                id: 'w1',
                name: 'North',
                location: 'l',
                fresh: 2,
                routes: [
                    route('a', {
                        type: 'Route',
                        grade_index: 7.4,
                        screw_date: '2026-09-25',
                    }),
                    route('b', {
                        type: 'Route',
                        grade_index: 7.4,
                        color: '#00f',
                    }),
                    route('c', { type: 'Route', grade_index: 13.4 }),
                ],
            },
            { id: 'w2', name: 'South', location: 'l', fresh: 0, routes: [] },
        ])

        const walls = wrapper.findAll('[data-testid="overview-wall"]')
        expect(walls).toHaveLength(2)
        expect(walls[0]!.text()).toContain('overview.wallNew:2')
        expect(walls[1]!.text()).not.toContain('overview.wallNew')

        const rails = walls[0]!.findAll('.wall-rails__rail')
        expect(rails).toHaveLength(1)
        const levels = rails[0]!
            .findAll('.wall-rails__dot')
            .map((dot) => dot.attributes('style'))
        expect(levels).toHaveLength(3)
        expect(levels[1]).toContain('--level: 1')
        expect(rails[0]!.findAll('.wall-rails__dot--fresh').length).toBe(1)
        expect(wrapper.text()).toContain('map.routes')
        expect(wrapper.text()).not.toContain('map.boulders')
    })
})
