import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import UserMemberships from '~/components/platform/UserMemberships.vue'
import { useReauth } from '~/composables/useReauth'
import { addMembership } from '~/api/members'
import { reauthenticate } from '~/api/account'

vi.mock('~/api/members', () => ({
    addMembership: vi.fn(async () => ({})),
    changeMembershipRole: vi.fn(),
    deleteMembership: vi.fn(),
}))
vi.mock('~/api/account', () => ({ reauthenticate: vi.fn() }))

const confirmDialogStub = {
    props: ['modelValue'],
    emits: ['confirm'],
    template: `<div v-if="modelValue" data-testid="confirm-dialog"><slot />
        <button data-testid="confirm-dialog-confirm" @click="$emit('confirm')" /></div>`,
}

function mountMemberships() {
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('useReauth', useReauth)
    vi.stubGlobal('useAsyncAction', () => ({
        pending: ref(false),
        run: async (action: () => Promise<unknown>) =>
            action().catch(() => undefined),
    }))
    const wrapper = mount(UserMemberships, {
        props: {
            user: { id: 'u1', memberships: [] } as never,
            gyms: [{ id: 'g1', slug: 'hall', name: 'Hall' }] as never,
            roles: [{ id: 'r1', gym: 'g1', name: 'routesetter' }] as never,
        },
        global: {
            stubs: {
                ConfirmDialog: confirmDialogStub,
                UserReauthField: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input data-testid="platform-user-add-membership-password"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                USelect: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UButton: {
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
    return wrapper
}

async function mountWithGym() {
    const wrapper = mountMemberships()
    await wrapper.get('[data-testid="platform-user-add-gym"]').setValue('g1')
    await flushPromises()
    return wrapper
}

describe('PlatformUserMemberships', () => {
    beforeEach(() => vi.clearAllMocks())

    it('confirms the admin password before adding a membership', async () => {
        const order: string[] = []
        vi.mocked(reauthenticate).mockImplementation(async () => {
            order.push('reauth')
        })
        vi.mocked(addMembership).mockImplementation(async () => {
            order.push('add')
            return {} as never
        })
        const wrapper = await mountWithGym()
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            false,
        )
        await wrapper
            .get('[data-testid="platform-user-add-membership"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="platform-user-add-membership-password"]')
            .setValue('secret')
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()

        expect(reauthenticate).toHaveBeenCalledWith('secret')
        expect(order).toEqual(['reauth', 'add'])
    })

    it('adds nothing when the password confirmation fails', async () => {
        vi.mocked(reauthenticate).mockRejectedValue(
            Object.assign(new Error('wrong'), { status: 403 }),
        )
        const wrapper = await mountWithGym()
        await wrapper
            .get('[data-testid="platform-user-add-membership"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()

        expect(addMembership).not.toHaveBeenCalled()
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            true,
        )
    })
})
