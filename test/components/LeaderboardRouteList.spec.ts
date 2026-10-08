import { mount } from '@vue/test-utils'
import RouteList from '~/components/leaderboard/RouteList.vue'
import LayoutListGroup from '~/components/layout/ListGroup.vue'
import LayoutListRow from '~/components/layout/ListRow.vue'
import RouteSummary from '~/components/route/Summary.vue'

const route = {
    id: 'r1',
    name: 'Crimp',
    color: 'red',
    grade: '7A',
    sends: 3,
    flashes: 2,
}

function mountList(routes: (typeof route & { points?: number })[]) {
    vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
    return mount(RouteList, {
        props: { routes },
        global: {
            components: { LayoutListGroup, LayoutListRow, RouteSummary },
            stubs: {
                GradeLabel: {
                    props: ['source'],
                    template: '<b>{{ source.grade }}</b>',
                },
                NuxtLink: {
                    props: ['to'],
                    template: '<a :href="to"><slot /></a>',
                },
                RouteColorDot: true,
                UIcon: true,
            },
        },
    })
}

describe('LeaderboardRouteList', () => {
    it('links each route and counts its sends and flashes', () => {
        const wrapper = mountList([route])
        expect(wrapper.get('a').attributes('href')).toBe('/gym/route?id=r1')
        expect(wrapper.text()).toContain('leaderboard.sends')
        expect(wrapper.text()).toContain('2')
        expect(wrapper.text()).toContain('7A')
    })

    it('shows the points a send scored instead of its send count', () => {
        const wrapper = mountList([{ ...route, points: 1883 }])
        expect(wrapper.text()).toContain('leaderboard.points')
        expect(wrapper.text()).not.toContain('leaderboard.sends')
    })
})
