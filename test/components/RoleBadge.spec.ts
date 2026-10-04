import { mount } from '@vue/test-utils'
import RoleBadge from '~/components/admin/RoleBadge.vue'

describe('RoleBadge', () => {
    it('fills the circle with the role colour and readable icon colour', () => {
        const wrapper = mount(RoleBadge, { props: { color: '#000000' } })

        expect(wrapper.attributes('style')).toContain(
            'background-color: #000000',
        )
        expect(wrapper.attributes('style')).toMatch(/color: (#fff|white)/i)
        expect(wrapper.classes()).not.toContain('bg-elevated')
    })

    it('falls back to the elevated surface without a colour', () => {
        const wrapper = mount(RoleBadge)

        expect(wrapper.classes()).toContain('bg-elevated')
        expect(wrapper.classes()).toContain('size-9')
    })

    it('renders larger for the detail header', () => {
        expect(mount(RoleBadge, { props: { size: 'lg' } }).classes()).toContain(
            'size-11',
        )
    })
})
