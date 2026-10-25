import { mount } from '@vue/test-utils'
import UserLastSeen from '~/components/platform/UserLastSeen.vue'
import UserMfa from '~/components/platform/UserMfa.vue'
import { useMountedNow } from '~/composables/useMountedNow'

vi.stubGlobal('useMountedNow', useMountedNow)

const stubs = { UTooltip: { template: '<div><slot /></div>' }, UIcon: true }

describe('PlatformUserMfa', () => {
    it('marks staff without 2FA as a warning', () => {
        const on = mount(UserMfa, {
            props: { enabled: true },
            global: { stubs },
        })
        expect(on.get('[data-testid="platform-user-mfa"]').classes()).toContain(
            'text-success',
        )
        expect(on.text()).toContain('platform.users.mfaOn')

        const staff = mount(UserMfa, {
            props: { staff: true },
            global: { stubs },
        })
        expect(
            staff.get('[data-testid="platform-user-mfa"]').classes(),
        ).toContain('text-warning')
        const climber = mount(UserMfa, { global: { stubs } })
        expect(
            climber.get('[data-testid="platform-user-mfa"]').classes(),
        ).toContain('text-muted')
    })
})

describe('PlatformUserLastSeen', () => {
    it('shows online now, a relative time with the exact date, or never', () => {
        const online = mount(UserLastSeen, {
            props: { lastSeen: new Date().toISOString() },
        })
        expect(online.attributes('data-tone')).toBe('online')
        expect(online.text()).toContain('platform.users.onlineNow')

        const recent = mount(UserLastSeen, {
            props: {
                lastSeen: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            },
        })
        expect(recent.attributes('data-tone')).toBe('active')
        expect(recent.findAll('span.text-xs')).toHaveLength(1)

        const compact = mount(UserLastSeen, {
            props: { lastSeen: recent.props('lastSeen'), compact: true },
        })
        expect(compact.findAll('span.text-xs')).toHaveLength(0)

        const never = mount(UserLastSeen, { props: { lastSeen: null } })
        expect(never.attributes('data-tone')).toBe('never')
        expect(never.text()).toContain('platform.users.never')
    })

    it('drops online now once the session goes quiet', async () => {
        vi.useFakeTimers()
        try {
            const wrapper = mount(UserLastSeen, {
                props: { lastSeen: new Date().toISOString() },
            })
            expect(wrapper.attributes('data-tone')).toBe('online')
            await vi.advanceTimersByTimeAsync(3 * 60_000)
            expect(wrapper.attributes('data-tone')).toBe('active')
        } finally {
            vi.useRealTimers()
        }
    })
})
