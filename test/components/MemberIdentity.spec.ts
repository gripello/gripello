import { mount } from '@vue/test-utils'
import MemberIdentity from '~/components/admin/MemberIdentity.vue'

const member = {
    user: 'u1',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    initials: 'AL',
    avatarUrl: null as string | null,
}

describe('MemberIdentity', () => {
    it('shows name, email and initials without an avatar', () => {
        const wrapper = mount(MemberIdentity, { props: { member } })

        expect(wrapper.attributes('data-testid')).toBe('member-card-u1')
        expect(wrapper.get('[data-testid="member-card-name"]').text()).toBe(
            'Ada Lovelace',
        )
        expect(wrapper.text()).toContain('ada@example.com')
        expect(wrapper.text()).toContain('AL')
        expect(wrapper.find('img').exists()).toBe(false)
    })

    it('shows the avatar image when there is one', () => {
        const wrapper = mount(MemberIdentity, {
            props: { member: { ...member, avatarUrl: '/a.png' } },
        })

        expect(wrapper.get('img').attributes('src')).toBe('/a.png')
        expect(wrapper.text()).not.toContain('AL')
    })
})
