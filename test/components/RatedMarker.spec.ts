import { mount } from '@vue/test-utils'
import RatedMarker from '~/components/route/RatedMarker.vue'

describe('RouteRatedMarker', () => {
    it('explains itself on hover and to screen readers', () => {
        const wrapper = mount(RatedMarker, {
            props: { size: 'sm' },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: { UIcon: { template: '<span />' } },
            },
        })

        expect(wrapper.attributes('title')).toBe('routes.rated')
        expect(wrapper.attributes('aria-label')).toBe('routes.rated')
        expect(wrapper.classes()).toContain('size-[14px]')
    })
})
