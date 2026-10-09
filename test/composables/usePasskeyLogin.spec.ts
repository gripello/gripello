import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { usePasskeyLogin } from '~/composables/usePasskeyLogin'

const send = vi.fn()

function setup() {
    let api!: ReturnType<typeof usePasskeyLogin>
    mount(
        defineComponent({
            setup() {
                api = usePasskeyLogin()
                return () => null
            },
        }),
    )
    return api
}

describe('usePasskeyLogin', () => {
    beforeEach(() => {
        send.mockReset()
        globalThis.__POCKETBASE_CLIENT__ = { send }
        vi.stubGlobal('onBeforeUnmount', () => {})
        vi.stubGlobal('PublicKeyCredential', {
            parseCreationOptionsFromJSON: vi.fn(),
            parseRequestOptionsFromJSON: vi.fn(() => ({})),
            isConditionalMediationAvailable: vi.fn().mockResolvedValue(true),
        })
    })

    it('adds the mfaId only for a second-factor sign-in', async () => {
        vi.stubGlobal('navigator', {
            credentials: {
                get: vi.fn().mockResolvedValue({ toJSON: () => ({ id: 'c' }) }),
            },
        })
        send.mockResolvedValueOnce({
            ceremony: 'x',
            options: {},
        }).mockResolvedValueOnce({})
        const passkey = setup()
        await passkey.signIn()
        expect(send).toHaveBeenLastCalledWith('/api/auth/passkey', {
            method: 'POST',
            body: { ceremony: 'x', credential: { id: 'c' } },
        })
        send.mockResolvedValueOnce({
            ceremony: 'y',
            options: {},
        }).mockResolvedValueOnce({})
        await passkey.signIn({ mfaId: 'm' })
        expect(send).toHaveBeenLastCalledWith('/api/auth/passkey', {
            method: 'POST',
            body: { ceremony: 'y', credential: { id: 'c' }, mfaId: 'm' },
        })
    })

    it('resolves quietly when autofill is stopped', async () => {
        vi.stubGlobal('navigator', {
            credentials: {
                get: vi.fn(
                    ({ signal }: { signal: AbortSignal }) =>
                        new Promise((_, reject) =>
                            signal.addEventListener('abort', () =>
                                reject(new DOMException('', 'AbortError')),
                            ),
                        ),
                ),
            },
        })
        send.mockResolvedValue({ ceremony: 'x', options: {} })
        const passkey = setup()
        const pending = passkey.autofill()
        await vi.waitFor(() => expect(passkey.autofillActive.value).toBe(true))
        await new Promise((resolve) => setTimeout(resolve))
        passkey.stopAutofill()
        await expect(pending).resolves.toBeUndefined()
    })

    it('stays quiet when autofill fails before a passkey is picked', async () => {
        vi.stubGlobal('navigator', {
            credentials: {
                get: vi
                    .fn()
                    .mockRejectedValue(new DOMException('', 'SecurityError')),
            },
        })
        send.mockResolvedValue({ ceremony: 'x', options: {} })
        await expect(setup().autofill()).resolves.toBeUndefined()

        send.mockReset().mockRejectedValue(new Error('offline'))
        await expect(setup().autofill()).resolves.toBeUndefined()
    })

    it('offers autofill again after the passkey sheet is dismissed', async () => {
        const get = vi
            .fn()
            .mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
            .mockResolvedValueOnce({ toJSON: () => ({ id: 'c' }) })
        vi.stubGlobal('navigator', { credentials: { get } })
        send.mockResolvedValueOnce({ ceremony: 'x', options: {} })
            .mockResolvedValueOnce({ ceremony: 'y', options: {} })
            .mockResolvedValueOnce({ token: 't' })
        await expect(setup().autofill()).resolves.toEqual({ token: 't' })
        expect(get).toHaveBeenCalledTimes(2)
        expect(send).toHaveBeenLastCalledWith('/api/auth/passkey', {
            method: 'POST',
            body: { ceremony: 'y', credential: { id: 'c' } },
        })
    })

    it('reports a picked passkey the server rejects', async () => {
        vi.stubGlobal('navigator', {
            credentials: {
                get: vi.fn().mockResolvedValue({ toJSON: () => ({ id: 'c' }) }),
            },
        })
        const rejected = Object.assign(new Error('unknown'), { status: 400 })
        send.mockResolvedValueOnce({
            ceremony: 'x',
            options: {},
        }).mockRejectedValueOnce(rejected)
        await expect(setup().autofill()).rejects.toBe(rejected)
    })
})
