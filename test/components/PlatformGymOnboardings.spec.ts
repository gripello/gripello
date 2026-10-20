import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import GymOnboardings from '~/components/platform/GymOnboardings.vue'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { createGymOnboarding } from '~/api/gyms'

vi.mock('~/api/gyms', () => ({
    listGymOnboardings: vi.fn(async () => [
        { id: 'o1', email: 'a@example.com', expires_at: '2026-01-01' },
        { id: 'o2', email: 'b@example.com', expires_at: '2026-01-01' },
    ]),
    createGymOnboarding: vi.fn(),
    deleteGymOnboarding: vi.fn(),
}))

const buttonStub = {
    props: ['loading', 'disabled'],
    template:
        "<button :data-loading=\"loading ? 'yes' : 'no'\" @click=\"$emit('click')\"><slot /></button>",
}

describe('PlatformGymOnboardings', () => {
    it('spins only the resend button of the row being resent', async () => {
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
        vi.stubGlobal('reactive', reactive)
        let finish!: () => void
        vi.mocked(createGymOnboarding).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = () => resolve(undefined as never)
                }),
        )
        const wrapper = mount(GymOnboardings, {
            global: {
                stubs: {
                    UButton: buttonStub,
                    LayoutPanel: { template: '<div><slot /></div>' },
                    LayoutListGroup: { template: '<div><slot /></div>' },
                    LayoutListRow: { template: '<div><slot /></div>' },
                    LayoutDialogShell: true,
                },
            },
        })
        await flushPromises()
        const resend = (email: string) =>
            wrapper.find(
                `[data-testid="platform-gym-onboarding-resend-${email}"]`,
            )
        await resend('a@example.com').trigger('click')
        expect(resend('a@example.com').attributes('data-loading')).toBe('yes')
        expect(resend('b@example.com').attributes('data-loading')).toBe('no')
        finish()
        await flushPromises()
        expect(resend('a@example.com').attributes('data-loading')).toBe('no')
    })
})
