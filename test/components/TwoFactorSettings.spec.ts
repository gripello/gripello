import { flushPromises, mount } from '@vue/test-utils'
import TwoFactorSettings from '~/components/account/TwoFactorSettings.vue'
import { routeApi } from '../api/apiMock'

const send = vi.fn()
const factor = (id: string, kind: 'totp' | 'passkey', name = '') => ({
    id,
    kind,
    name,
    created: '2026-10-01 10:00:00Z',
    last_used: '',
})

function mountSettings() {
    return mount(TwoFactorSettings, {
        global: {
            stubs: {
                UPageCard: { template: '<div><slot /></div>' },
                UIcon: true,
                UForm: {
                    emits: ['submit'],
                    template:
                        '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
                },
                UFormField: { template: '<div><slot /></div>' },
                UPinInput: {
                    emits: ['complete'],
                    mounted() {
                        this.$emit('complete', [])
                    },
                    template: '<div data-testid="two-factor-setup-code" />',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                UserPasswordField: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<input data-testid="two-factor-password" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                LayoutDialogShell: {
                    props: ['modelValue'],
                    template:
                        '<div v-if="modelValue"><slot /><slot name="actions" /></div>',
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('TwoFactorSettings', () => {
    beforeEach(() => {
        send.mockReset()
        globalThis.__AUTH_STORE__ = { record: { email: 'me@example.com' } }
        routeApi(send)
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) => action(),
        }))
    })

    it('offers setup when no factor exists and hides recovery codes', async () => {
        send.mockResolvedValue({ factors: [], recoveryCodesLeft: 0 })
        const wrapper = mountSettings()
        await flushPromises()
        expect(
            wrapper.find('[data-testid="two-factor-totp-setup"]').exists(),
        ).toBe(true)
        expect(
            wrapper
                .find('[data-testid="two-factor-codes-regenerate"]')
                .exists(),
        ).toBe(false)
    })

    it('lists factors with the remaining recovery codes', async () => {
        send.mockResolvedValue({
            factors: [
                factor('t', 'totp'),
                factor('p', 'passkey', 'Chrome · macOS'),
            ],
            recoveryCodesLeft: 2,
        })
        const wrapper = mountSettings()
        await flushPromises()
        expect(
            wrapper.find('[data-testid="two-factor-totp-remove"]').exists(),
        ).toBe(true)
        expect(
            (
                wrapper.get('[data-testid="two-factor-name-p"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('Chrome · macOS')
        expect(
            wrapper.get('[data-testid="two-factor-codes-left"]').classes(),
        ).toContain('text-warning')
    })

    it('removes a factor only with the password', async () => {
        send.mockResolvedValueOnce({
            factors: [factor('t', 'totp')],
            recoveryCodesLeft: 10,
        })
        const wrapper = mountSettings()
        await flushPromises()
        await wrapper
            .get('[data-testid="two-factor-totp-remove"]')
            .trigger('click')
        const username = wrapper.get('[data-testid="two-factor-username"]')
        expect(username.attributes('autocomplete')).toBe('username')
        expect((username.element as HTMLInputElement).value).toBe(
            'me@example.com',
        )
        await wrapper
            .get('[data-testid="two-factor-password"]')
            .setValue('secret')
        send.mockResolvedValueOnce(null)
        await wrapper.get('form').trigger('submit')
        await flushPromises()
        expect(send).toHaveBeenLastCalledWith('/me/mfa/t', {
            method: 'DELETE',
            body: { password: 'secret' },
        })
        expect(
            wrapper.find('[data-testid="two-factor-password"]').exists(),
        ).toBe(false)
        expect(
            wrapper.find('[data-testid="two-factor-totp-setup"]').exists(),
        ).toBe(true)
    })

    it('reports edited names to the page save bar and saves them', async () => {
        send.mockResolvedValueOnce({
            factors: [factor('p', 'passkey', 'Chrome · Linux')],
            recoveryCodesLeft: 10,
        })
        const wrapper = mountSettings()
        await flushPromises()
        const settings = wrapper.vm as unknown as {
            namesChanged: boolean
            saveNames: () => Promise<void>
            resetNames: () => void
        }
        expect(settings.namesChanged).toBe(false)
        await wrapper
            .get('[data-testid="two-factor-name-p"]')
            .setValue('YubiKey')
        expect(settings.namesChanged).toBe(true)

        send.mockResolvedValueOnce(factor('p', 'passkey', 'YubiKey'))
        await settings.saveNames()
        expect(send).toHaveBeenLastCalledWith('/me/mfa/p', {
            method: 'PATCH',
            body: { name: 'YubiKey' },
        })
        expect(settings.namesChanged).toBe(false)

        await wrapper.get('[data-testid="two-factor-name-p"]').setValue('Other')
        settings.resetNames()
        expect(settings.namesChanged).toBe(false)
    })

    it('does not verify the setup before six digits are typed', async () => {
        vi.doMock('qrcode', () => ({
            default: { toDataURL: vi.fn().mockResolvedValue('data:') },
        }))
        send.mockResolvedValueOnce({ factors: [], recoveryCodesLeft: 0 })
        const wrapper = mountSettings()
        await flushPromises()
        send.mockResolvedValueOnce({
            secret: 'ABCDEFGHIJKLMNOP',
            uri: 'otpauth://x',
        })
        await wrapper
            .get('[data-testid="two-factor-totp-setup"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="two-factor-password"]')
            .setValue('secret')
        await wrapper.get('form').trigger('submit')
        expect(send).toHaveBeenLastCalledWith('/me/totp/setup', {
            method: 'POST',
            body: { password: 'secret' },
        })
        await vi.waitFor(() =>
            expect(
                wrapper.find('[data-testid="two-factor-setup-code"]').exists(),
            ).toBe(true),
        )
        await flushPromises()
        expect(send).not.toHaveBeenCalledWith('/me/totp', expect.anything())
    })
})
