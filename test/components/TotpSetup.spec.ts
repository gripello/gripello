import { flushPromises, mount } from '@vue/test-utils'
import AccountTotpSetup from '~/components/account/TotpSetup.vue'

const pending: Record<string, (url: string) => void> = {}
vi.mock('qrcode', () => ({
    default: {
        toDataURL: (uri: string) =>
            new Promise<string>((resolve) => (pending[uri] = resolve)),
    },
}))

describe('AccountTotpSetup', () => {
    beforeEach(() => {
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: vi.fn(),
        }))
    })

    it('keeps the QR code of the current setup when an older one renders late', async () => {
        const wrapper = mount(AccountTotpSetup, {
            props: {
                setup: { secret: 'A', uri: 'otpauth://a', password: 'p' },
            },
            global: {
                stubs: {
                    LayoutDialogShell: { template: '<div><slot /></div>' },
                    UForm: { template: '<form><slot /></form>' },
                    UFormField: { template: '<div><slot /></div>' },
                    UPinInput: true,
                },
            },
        })
        await vi.waitFor(() => expect(pending['otpauth://a']).toBeDefined())
        await wrapper.setProps({
            setup: { secret: 'B', uri: 'otpauth://b', password: 'p' },
        })
        await vi.waitFor(() => expect(pending['otpauth://b']).toBeDefined())

        pending['otpauth://b']!('data:b')
        await flushPromises()
        pending['otpauth://a']!('data:a')
        await flushPromises()

        expect(wrapper.get('img').attributes('src')).toBe('data:b')
    })
})
