import {
    createPasskey,
    getPasskey,
    isPasskeyCancel,
    passkeyAutofillAvailable,
    passkeysSupported,
} from '~/utils/webauthn'

describe('webauthn', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('needs the JSON helpers of the browser', () => {
        vi.stubGlobal('PublicKeyCredential', undefined)
        expect(passkeysSupported()).toBe(false)
        vi.stubGlobal('PublicKeyCredential', {
            parseCreationOptionsFromJSON: vi.fn(),
            parseRequestOptionsFromJSON: vi.fn(),
        })
        expect(passkeysSupported()).toBe(!!navigator.credentials)
    })

    it('passes server options through and returns the credential as JSON', async () => {
        const parsed = { challenge: new Uint8Array([1]) }
        vi.stubGlobal('PublicKeyCredential', {
            parseCreationOptionsFromJSON: vi.fn(() => parsed),
            parseRequestOptionsFromJSON: vi.fn(() => parsed),
        })
        const credential = { toJSON: () => ({ id: 'cred' }) }
        const create = vi.fn().mockResolvedValue(credential)
        const get = vi.fn().mockResolvedValue(credential)
        vi.stubGlobal('navigator', { credentials: { create, get } })

        expect(await createPasskey({ challenge: 'AQ' })).toEqual({ id: 'cred' })
        expect(create).toHaveBeenCalledWith({ publicKey: parsed })
        expect(await getPasskey({ challenge: 'AQ' })).toEqual({ id: 'cred' })
        expect(get).toHaveBeenCalledWith({ publicKey: parsed })
    })

    it('offers passkeys as autofill only where the browser can', async () => {
        const isConditionalMediationAvailable = vi.fn().mockResolvedValue(true)
        vi.stubGlobal('PublicKeyCredential', {
            parseCreationOptionsFromJSON: vi.fn(),
            parseRequestOptionsFromJSON: vi.fn(() => ({})),
            isConditionalMediationAvailable,
        })
        const get = vi.fn().mockResolvedValue({ toJSON: () => ({}) })
        vi.stubGlobal('navigator', { credentials: { get } })
        expect(await passkeyAutofillAvailable()).toBe(true)
        isConditionalMediationAvailable.mockRejectedValue(new Error('nope'))
        expect(await passkeyAutofillAvailable()).toBe(false)

        const abort = new AbortController()
        await getPasskey({}, abort)
        expect(get).toHaveBeenCalledWith({
            publicKey: {},
            mediation: 'conditional',
            signal: abort.signal,
        })
    })

    it('treats a dismissed prompt as a cancel', () => {
        expect(isPasskeyCancel(new DOMException('', 'NotAllowedError'))).toBe(
            true,
        )
        expect(isPasskeyCancel(new Error('boom'))).toBe(false)
    })
})
