import { mount } from '@vue/test-utils'
import ClimberAvatar from '~/components/climber/Avatar.vue'

describe('ClimberAvatar', () => {
    it('prefers a resolved src', () => {
        const wrapper = mount(ClimberAvatar, {
            props: { name: 'Ada Lovelace', src: 'blob:abc', size: 'xs' },
        })

        expect(wrapper.find('img').attributes('src')).toBe('blob:abc')
        expect(wrapper.classes()).toContain('size-6')
    })

    it('resolves the avatar file of a climber', () => {
        const wrapper = mount(ClimberAvatar, {
            props: { id: 'u1', name: 'Ada', avatar: 'a.png' },
        })

        expect(wrapper.find('img').attributes('src')).toBe(
            '/api/files/users/u1/a.png?thumb=100x100',
        )
    })

    it('falls back to initials', () => {
        const wrapper = mount(ClimberAvatar, {
            props: { name: 'Ada Lovelace' },
        })

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toBe('AL')
    })
})
