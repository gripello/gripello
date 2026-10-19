import { mount } from '@vue/test-utils'
import MapRouteList from '~/components/map/RouteList.vue'
import type { RouteListItem } from '~/types/models'

describe('MapRouteList', () => {
    it('gives the open link a full touch target', () => {
        vi.stubGlobal('useGymPath', () => (path: string) => `/e2e${path}`)
        vi.stubGlobal('resolveComponent', () => 'a')
        const wrapper = mount(MapRouteList, {
            props: {
                groups: [
                    {
                        id: 'w1',
                        name: 'Wall',
                        routes: [{ id: 'r1', name: 'Arete' } as RouteListItem],
                    },
                ],
                showHeadings: false,
                tickedIds: new Set<string>(),
                selectedRouteId: null,
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    NuxtLink: { template: '<a><slot /></a>' },
                    RouteSummary: true,
                    TaskDefectMarker: true,
                    UIcon: true,
                    LayoutEyebrow: true,
                    LayoutEmptyState: true,
                },
            },
        })
        expect(wrapper.find('[data-testid="route-view"]').classes()).toContain(
            'icon-btn',
        )
    })
})
