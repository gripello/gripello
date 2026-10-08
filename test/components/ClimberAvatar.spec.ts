import { mount } from '@vue/test-utils'
import ClimberAvatar from '~/components/climber/Avatar.vue'

describe('ClimberAvatar', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'usePbFileUrl',
            (_record: unknown, file: string | null) =>
                file ? `/files/${file}` : '',
        )
    })

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

        expect(wrapper.find('img').attributes('src')).toBe('/files/a.png')
    })

    it('falls back to initials', () => {
        const wrapper = mount(ClimberAvatar, {
            props: { name: 'Ada Lovelace' },
        })

        expect(wrapper.find('img').exists()).toBe(false)
        expect(wrapper.text()).toBe('AL')
    })
})
