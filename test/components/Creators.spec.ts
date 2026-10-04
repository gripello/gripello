import { mount } from '@vue/test-utils'
import Creators from '~/components/route/Creators.vue'

describe('RouteCreators', () => {
    it('lists setters as plain text, clamped to two lines with the full list on hover', () => {
        const wrapper = mount(Creators, {
            props: { creators: ['Tilo Alexander (JSG)', 'Jochen'] },
        })

        expect(wrapper.text()).toBe('Tilo Alexander (JSG), Jochen')
        expect(wrapper.attributes('title')).toBe('Tilo Alexander (JSG), Jochen')
        expect(wrapper.classes()).toContain('line-clamp-2')
    })
})
