import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import FeedActivity from '~/components/feed/Activity.vue'
import LayoutEyebrow from '~/components/layout/Eyebrow.vue'
import LayoutListGroup from '~/components/layout/ListGroup.vue'
import LayoutListRow from '~/components/layout/ListRow.vue'
import RouteSummary from '~/components/route/Summary.vue'
import type { FeedTick } from '~/utils/friends'

const tick = (id: string, user: string, date: string): FeedTick =>
    ({
        id,
        user,
        route: `r-${id}`,
        type: 'flash',
        date,
        created: date,
        expand: { route: { id: `r-${id}`, name: `Route ${id}` } },
    }) as FeedTick

function mountActivity(props: Record<string, unknown>, hydrated = true) {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useHydrated', () => ref(hydrated))
    vi.stubGlobal('useI18n', () => ({
        t: (key: string) => key,
        locale: { value: 'en' },
    }))
    return mount(FeedActivity, {
        props,
        global: {
            components: {
                LayoutEyebrow,
                LayoutListGroup,
                LayoutListRow,
                RouteSummary,
            },
            stubs: {
                NuxtLink: {
                    props: ['to'],
                    template: '<a :href="to"><slot /></a>',
                },
                ClimberAvatar: true,
                RouteColorDot: true,
                GradeLabel: true,
                UBadge: { template: '<span><slot /></span>' },
            },
        },
    })
}

describe('FeedActivity', () => {
    const ticks = [
        tick('a', 'u1', '2026-09-01 10:00:00.000Z'),
        tick('b', 'u2', '2026-09-02 10:00:00.000Z'),
    ]

    it('groups sends by day, newest first, with the climber linked', () => {
        const wrapper = mountActivity({
            ticks,
            climbers: new Map([['u2', { id: 'u2', name: 'Ben', avatar: '' }]]),
        })
        const sends = wrapper.findAll('[data-testid="feed-send"]')
        expect(sends).toHaveLength(2)
        expect(sends[0]!.text()).toContain('Ben')
        expect(sends[0]!.find('a').attributes('href')).toBe('/climber?id=u2')
        expect(sends[1]!.text()).toContain('feed.someone')
    })

    it('leads with the route when the climber is known', () => {
        const wrapper = mountActivity({ ticks, hideUser: true })
        expect(wrapper.html()).not.toContain('/climber?id=')
        expect(wrapper.find('[data-testid="feed-send"]').text()).toContain(
            'Route b',
        )
    })

    it('names the climber on the avatar link', () => {
        const wrapper = mountActivity({
            ticks: [ticks[0]],
            climbers: new Map([['u1', { id: 'u1', name: 'Anna', avatar: '' }]]),
        })
        expect(wrapper.find('a').attributes('aria-label')).toBe('Anna')
    })

    it.each([false, true])(
        'shows a removed route without a link (hideUser: %s)',
        (hideUser) => {
            const removed = {
                ...tick('c', 'u1', '2026-09-03 10:00:00.000Z'),
                route: '',
                route_name: '',
                expand: {},
            } as FeedTick
            const wrapper = mountActivity({ ticks: [removed], hideUser })
            expect(wrapper.html()).not.toContain('/route?id=')
            expect(wrapper.text()).toContain('ticks.removedRoute')
        },
    )

    it('waits for hydration before showing relative times', () => {
        const wrapper = mountActivity({ ticks: [ticks[0]] }, false)
        expect(wrapper.text()).not.toContain('time.')
        expect(wrapper.text()).not.toContain('feed.today')
    })
})
