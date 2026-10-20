import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import RouteFlags from '~/components/manage/RouteFlags.vue'
import RouteReset from '~/components/manage/RouteReset.vue'

const route = {
    id: 'route1',
    name: 'Crimp',
    permanent: false,
    removal_planned_for: null,
    screw_date: '2026-01-01',
}
const stat = {
    route: 'route1',
    recent_ticks: 2,
    ticks: 4,
    climbers: 3,
    ratings: 2,
    average_rating: 3.5,
    grade_deviation: null,
    open_defects: 0,
}

describe('reset rating labels', () => {
    beforeEach(() => {
        vi.stubGlobal('useI18n', () => ({
            t: (key: string) => key,
            locale: ref('de'),
        }))
        vi.stubGlobal('useGymPath', () => (path: string) => path)
        vi.stubGlobal('useCurrentGymId', () => ref('gym1'))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: vi.fn(),
        }))
    })

    it('formats the average rating in the viewer locale on the flags', () => {
        const wrapper = mount(RouteFlags, {
            props: { route, flags: [], stat, now: new Date('2026-06-01') },
            global: { stubs: { UIcon: true } },
        })

        expect(wrapper.text()).toContain('★ 3,5')
    })

    it('formats the average rating in the viewer locale on the facts', () => {
        const wrapper = mount(RouteReset, {
            props: { route, flags: [], stat, now: new Date('2026-06-01') },
            global: {
                stubs: {
                    ManageRouteFlags: true,
                    UButton: true,
                    UInput: true,
                    UIcon: true,
                },
            },
        })

        expect(
            wrapper.get('[data-testid="route-reset-stars"]').text(),
        ).toContain('★ 3,5 (2)')
    })
})
