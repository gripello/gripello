import { mount } from '@vue/test-utils'
import RouteCard from '~/components/route/Card.vue'
import type { RouteListItem } from '~/types/models'

function createWrapper(anchor_point: unknown, extra: object = {}) {
    return mount(RouteCard, {
        props: {
            route: {
                id: 'r1',
                name: 'Nordwand',
                anchor_point,
                ...extra,
            } as unknown as RouteListItem,
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                RouteColorDot: true,
                GradeLabel: true,
                TaskDefectMarker: true,
                RouteRatedMarker: true,
                UIcon: true,
            },
        },
    })
}

describe('RouteCard', () => {
    it.each([null, undefined, '', 0])(
        'hides the anchor pill for %s',
        (anchor) => {
            expect(
                createWrapper(anchor)
                    .find('[data-testid="route-card-anchor"]')
                    .exists(),
            ).toBe(false)
        },
    )

    it('shows a set anchor', () => {
        expect(
            createWrapper(7).find('[data-testid="route-card-anchor"]').text(),
        ).toContain('7')
    })

    it('puts setters and set date on one meta line', () => {
        const line = createWrapper(null, {
            creator: ['Ana', 'Ben'],
            screw_date: '2026-10-12',
        }).get('[data-testid="route-card-set-by"]')
        expect(line.text()).toMatch(/^Ana, Ben · .*2026/)
        expect(
            createWrapper(null)
                .find('[data-testid="route-card-set-by"]')
                .exists(),
        ).toBe(false)
    })
})
