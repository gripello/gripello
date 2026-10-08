import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TwoFactorStep from '~/components/auth/TwoFactorStep.vue'

const send = vi.fn()
const signIn = vi.fn()
const result = { token: 't', record: { id: 'me' } }

function mountStep(methods: string[], method = methods[0]) {
    return mount(TwoFactorStep, {
        props: { mfaId: 'mfa1', methods, method } as never,
        global: {
            stubs: {
                UFormField: {
                    props: ['error'],
                    template:
                        '<div><slot /><p v-if="error" data-testid="field-error">{{ error }}</p></div>',
                },
                UPinInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue', 'complete'],
                    template:
                        '<input data-testid="two-factor-code" :value="(modelValue ?? []).join(\'\')" @input="$emit(\'update:modelValue\', [...$event.target.value].map(Number)); $event.target.value.length === 6 && $emit(\'complete\')" />',
                },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<input data-testid="two-factor-recovery" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                USeparator: true,
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                UIcon: true,
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

describe('TwoFactorStep', () => {
    beforeEach(() => {
        send.mockReset()
        signIn.mockReset()
        globalThis.__POCKETBASE_CLIENT__ = { send }
        vi.stubGlobal('usePasskeyLogin', () => ({ signIn }))
        vi.stubGlobal('useTemplateRef', () => ref(null))
        vi.stubGlobal('nextTick', nextTick)
        vi.stubGlobal('PublicKeyCredential', undefined)
    })

    it('offers only the other methods the account has', () => {
        const wrapper = mountStep(['totp', 'recovery'])
        expect(
            wrapper.find('[data-testid="two-factor-method-recovery"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="two-factor-method-passkey"]').exists(),
        ).toBe(false)
        expect(
            wrapper.find('[data-testid="two-factor-method-totp"]').exists(),
        ).toBe(false)
    })

    it('submits a complete code once', async () => {
        send.mockResolvedValue(result)
        const wrapper = mountStep(['totp'])
        await wrapper.get('[data-testid="two-factor-code"]').setValue('123456')
        await flushPromises()
        expect(send).toHaveBeenCalledTimes(1)
        expect(send).toHaveBeenCalledWith('/api/auth/totp', {
            method: 'POST',
            body: { mfaId: 'mfa1', code: '123456' },
        })
        expect(wrapper.emitted('authenticated')).toEqual([[result]])
    })

    it('shows a wrong code inline and clears the boxes', async () => {
        send.mockRejectedValue({
            status: 400,
            response: { message: 'Failed to authenticate.' },
        })
        const wrapper = mountStep(['totp'])
        await wrapper.get('[data-testid="two-factor-code"]').setValue('000000')
        await flushPromises()
        expect(wrapper.get('[data-testid="field-error"]').text()).toBe(
            'account.twoFactor.invalidCode',
        )
        expect(
            (
                wrapper.get('[data-testid="two-factor-code"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('')
        expect(wrapper.emitted('failed')).toBeUndefined()
    })

    it('ends the step when the session expired or the account is locked', async () => {
        send.mockRejectedValue({
            status: 429,
            response: { message: 'Account temporarily locked.' },
        })
        const wrapper = mountStep(['totp'])
        await wrapper.get('[data-testid="two-factor-code"]').setValue('000000')
        await flushPromises()
        expect(wrapper.emitted('failed')).toHaveLength(1)
    })

    it('formats and sends a recovery code', async () => {
        send.mockResolvedValue(result)
        const wrapper = mountStep(['totp', 'recovery'], 'recovery')
        await wrapper
            .get('[data-testid="two-factor-recovery"]')
            .setValue('ABCDEFGHIJKLMNOP')
        await wrapper.get('form').trigger('submit')
        await flushPromises()
        expect(send).toHaveBeenCalledWith('/api/auth/recovery', {
            method: 'POST',
            body: { mfaId: 'mfa1', code: 'abcd-efgh-ijkl-mnop' },
        })
    })

    it('opens the passkey prompt right away when that is the main method', async () => {
        vi.stubGlobal('PublicKeyCredential', {
            parseCreationOptionsFromJSON: vi.fn(),
            parseRequestOptionsFromJSON: vi.fn(),
        })
        vi.stubGlobal('navigator', { credentials: {} })
        signIn.mockResolvedValue(result)
        const wrapper = mountStep(['passkey', 'recovery'])
        await flushPromises()
        expect(signIn).toHaveBeenCalledWith({ mfaId: 'mfa1' })
        expect(wrapper.emitted('authenticated')).toEqual([[result]])
    })
})
