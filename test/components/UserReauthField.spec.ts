import { flushPromises, mount } from '@vue/test-utils'
import ReauthField from '~/components/user/ReauthField.vue'
import { providerConfirmation } from '~/utils/providerReauth'

const confirmWith = vi.fn()
const linked = ref<{
    items: { id: string; provider: string }[]
    hasPassword: boolean
} | null>(null)

function mountField() {
    vi.stubGlobal('useNotification', () => ({ error: vi.fn() }))
    vi.stubGlobal('useAsyncData', (key: string) =>
        key === 'linked-accounts'
            ? { data: linked }
            : { data: ref([{ name: 'oidc', displayName: 'Club login' }]) },
    )
    vi.stubGlobal('useProviderReauth', () => ({
        pending: ref(''),
        failed: ref(false),
        confirmed: computed(() => !!providerConfirmation.value),
        confirmWith,
    }))
    return mount(ReauthField, {
        global: {
            stubs: {
                UserPasswordField: {
                    template: '<input data-testid="reauth-password" />',
                },
                UButton: {
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('UserReauthField', () => {
    beforeEach(() => {
        confirmWith.mockReset()
        providerConfirmation.value = null
    })

    it('asks for the password when the account has one', async () => {
        linked.value = {
            items: [{ id: 'i1', provider: 'oidc' }],
            hasPassword: true,
        }
        const wrapper = mountField()
        await flushPromises()
        expect(wrapper.find('[data-testid="reauth-password"]').exists()).toBe(
            true,
        )
        expect(wrapper.find('[data-testid="reauth-providers"]').exists()).toBe(
            false,
        )
    })

    it('offers the linked providers to an account without a password', async () => {
        linked.value = {
            items: [{ id: 'i1', provider: 'oidc' }],
            hasPassword: false,
        }
        const wrapper = mountField()
        await flushPromises()
        expect(wrapper.find('[data-testid="reauth-password"]').exists()).toBe(
            false,
        )
        const button = wrapper.get('[data-testid="reauth-provider-oidc"]')
        expect(button.text()).toBe('auth.reauth.confirmWith')
        await button.trigger('click')
        expect(confirmWith).toHaveBeenCalledWith('oidc')
    })

    it('shows the confirmation once the provider confirmed', async () => {
        linked.value = {
            items: [{ id: 'i1', provider: 'oidc' }],
            hasPassword: false,
        }
        providerConfirmation.value = { user: 'u1', at: Date.now() }
        const wrapper = mountField()
        await flushPromises()
        expect(wrapper.get('[data-testid="reauth-provider-oidc"]').text()).toBe(
            'auth.reauth.confirmed',
        )
    })
})
