import { mount } from '@vue/test-utils'
import RouteCard from '~/components/route/Card.vue'
import type { RouteListItem } from '~/types/models'

function createWrapper(anchor_point: unknown) {
    return mount(RouteCard, {
        props: {
            route: {
                id: 'r1',
                name: 'Nordwand',
                anchor_point,
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
})
