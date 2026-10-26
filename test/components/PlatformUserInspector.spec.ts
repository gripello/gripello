import { flushPromises, mount } from '@vue/test-utils'
import UserInspector from '~/components/platform/UserInspector.vue'
import { liftSuspension, updatePlatformUser } from '~/api/platform'
import { useMountedNow } from '~/composables/useMountedNow'
import { requestVerification } from '~/api/auth'

vi.stubGlobal('useMountedNow', useMountedNow)

vi.mock('~/api/platform', () => ({
    clearUserLockout: vi.fn(),
    getPlatformUser: vi.fn(async () => ({ ticks_count: 4 })),
    liftSuspension: vi.fn(),
    listUserSessions: vi.fn(async () => []),
    updatePlatformUser: vi.fn(),
}))
vi.mock('~/api/auth', () => ({
    requestVerification: vi.fn(),
}))
vi.mock('~/api/audit', () => ({
    listPlatformAudit: vi.fn(async () => ({ items: [] })),
}))

const alertStub = {
    props: ['actions', 'title'],
    template: `<div data-testid="platform-user-alert">{{ title }}
        <button v-for="action in actions ?? []" :key="action.label"
            :data-testid="action['data-testid']" @click="action.onClick()">
            {{ action.label }}</button></div>`,
}

function mountFor(user: Record<string, unknown>) {
    vi.stubGlobal('useCapToken', () => ({
        capHeaders: async () => ({ 'X-Cap-Token': 'token' }),
    }))
    vi.stubGlobal('useAsyncAction', () => ({
        pending: ref(false),
        run: async (action: () => Promise<unknown>) => action(),
    }))
    return mount(UserInspector, {
        props: {
            user: {
                id: 'u1',
                username: 'ada',
                verified: true,
                ...user,
            } as never,
            gyms: [],
            roles: [],
        },
        global: {
            stubs: {
                UAlert: alertStub,
                LayoutTabs: true,
                LayoutStatTile: true,
                PlatformUserMemberships: true,
                PlatformUserBadges: true,
                ClimberAvatar: true,
            },
        },
    })
}

describe('PlatformUserInspector', () => {
    it('marks an unverified account as verified from the alert', async () => {
        const wrapper = mountFor({ verified: false })
        await wrapper
            .get('[data-testid="platform-user-alert-action"]')
            .trigger('click')
        await flushPromises()
        expect(updatePlatformUser).toHaveBeenCalledWith('u1', {
            verified: true,
        })
        expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('resends the verification e-mail from the unverified alert', async () => {
        const wrapper = mountFor({
            verified: false,
            email: 'ada@gripello.test',
        })
        await wrapper
            .get('[data-testid="platform-user-alert-resend"]')
            .trigger('click')
        await flushPromises()
        expect(requestVerification).toHaveBeenCalledWith('ada@gripello.test', {
            'X-Cap-Token': 'token',
        })
        expect(
            mountFor({ verified: false })
                .find('[data-testid="platform-user-alert-resend"]')
                .exists(),
        ).toBe(false)
    })

    it('lifts a suspension before anything else', async () => {
        const wrapper = mountFor({
            verified: false,
            suspended_until: '2099-01-01T00:00:00.000Z',
        })
        await wrapper
            .get('[data-testid="platform-user-alert-action"]')
            .trigger('click')
        expect(liftSuspension).toHaveBeenCalledWith('u1')
    })

    it('flags staff without two-factor without offering a fix', () => {
        const wrapper = mountFor({
            mfa_enabled: false,
            memberships: [{ id: 'm1', gym: 'g1', role: 'r1' }],
        })
        expect(
            wrapper.find('[data-testid="platform-user-alert"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="platform-user-alert-action"]').exists(),
        ).toBe(false)
    })
})
