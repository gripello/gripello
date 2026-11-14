import { mount } from '@vue/test-utils'
import CohortTable from '~/components/platform/CohortTable.vue'
import FeatureTable from '~/components/platform/FeatureTable.vue'
import GymAdoption from '~/components/platform/GymAdoption.vue'

const stubs = {
    AnalyticsSection: { template: '<div><slot /></div>' },
    UBadge: { template: '<span data-testid="trend"><slot /></span>' },
}

describe('PlatformCohortTable', () => {
    it('shows rates of each signup month, newest first, and hides steps not reached yet', () => {
        const wrapper = mount(CohortTable, {
            props: {
                retentionWeeks: [2, 4, 12],
                cohorts: [
                    {
                        month: '2026-06',
                        accounts: 10,
                        verified: 8,
                        first_log: 5,
                        back: [6, 5, null],
                    },
                    {
                        month: '2026-11',
                        accounts: null,
                        verified: null,
                        first_log: null,
                        back: [null, null, null],
                    },
                ],
            },
            global: { stubs },
        })
        const rows = wrapper.findAll('tbody tr')
        expect(rows[0]!.attributes('data-testid')).toBe(
            'platform-cohort-2026-11',
        )
        expect(rows[0]!.text()).toContain('platform.insights.fewPeople')
        const cells = rows[1]!.findAll('td').map((cell) => cell.text())
        expect(cells.slice(1)).toEqual(['10', '80%', '50%', '60%', '50%', '—'])
    })
})

describe('PlatformFeatureTable', () => {
    it('labels features, hides small counts and compares with the previous range', () => {
        const wrapper = mount(FeatureTable, {
            props: {
                features: [
                    {
                        feature: 'logbook.log',
                        requests: 150,
                        previous_requests: 100,
                        people_per_day: 12.5,
                        signed_in_share: 1,
                        app_share: 0.25,
                    },
                    {
                        feature: 'routes.detail',
                        requests: 3,
                        previous_requests: 0,
                        people_per_day: null,
                        signed_in_share: null,
                        app_share: null,
                    },
                ],
            },
            global: { stubs },
        })
        const logs = wrapper.get('[data-testid="platform-feature-logbook.log"]')
        expect(logs.text()).toContain('platform.insights.names.logbook.log')
        expect(logs.get('[data-testid="trend"]').text()).toBe('+50%')
        expect(logs.text()).toContain('25%')
        const detail = wrapper.get(
            '[data-testid="platform-feature-routes.detail"]',
        )
        expect(detail.text()).toContain('platform.insights.fewPeople')
        expect(detail.find('[data-testid="trend"]').exists()).toBe(false)
    })
})

describe('PlatformGymAdoption', () => {
    const adoption = [
        {
            gym: 'north',
            climbers: 12,
            logs: 60,
            previous_logs: 50,
            reviews: 4,
            routes_set: 9,
            last_route_set_at: '2026-11-10T08:00:00.000Z',
            features: ['tasks', 'tv'] as ('tasks' | 'tv')[],
        },
        {
            gym: 'south',
            climbers: null,
            logs: 5,
            previous_logs: 40,
            reviews: 0,
            routes_set: 0,
            last_route_set_at: null,
            features: [],
        },
    ]

    function mountAdoption() {
        return mount(GymAdoption, {
            props: { adoption, gyms: [] },
            global: {
                stubs: {
                    ...stubs,
                    NuxtLink: { template: '<a><slot /></a>' },
                    SegmentedControl: true,
                    UBadge: { template: '<span class="badge"><slot /></span>' },
                },
            },
        })
    }

    it('flags gyms whose logs halved and lists the tools in use', () => {
        const wrapper = mountAdoption()
        expect(
            wrapper.find('[data-testid="platform-gym-quiet-south"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="platform-gym-quiet-north"]').exists(),
        ).toBe(false)
        const north = wrapper.get('[data-testid="platform-gym-adoption-north"]')
        expect(north.text()).toContain('platform.insights.gyms.features.tv')
        expect(north.text()).toContain('+20%')
        expect(
            wrapper.get('[data-testid="platform-gym-adoption-south"]').text(),
        ).toContain('platform.insights.fewPeople')
    })
})
