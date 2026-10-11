import {
    passkeyLogin,
    passkeyLoginOptions,
    type AuthResult,
    type PickedPasskey,
} from '~/api/auth'
import {
    getPasskey,
    isPasskeyCancel,
    passkeyAutofillAvailable,
    passkeysSupported,
} from '~/utils/webauthn'

export function usePasskeyLogin() {
    const supported = ref(false)
    const autofillActive = ref(false)
    let autofillAbort: AbortController | undefined

    onMounted(() => (supported.value = passkeysSupported()))
    onBeforeUnmount(() => autofillAbort?.abort())

    async function pickPasskey(autofill?: AbortController) {
        const ceremony = await passkeyLoginOptions()
        const credential = await getPasskey(ceremony.options, autofill)
        return { ceremony: ceremony.ceremony, credential }
    }

    async function signIn(options: { mfaId?: string } = {}) {
        return passkeyLogin(await pickPasskey(), options.mfaId)
    }

    async function autofill(): Promise<AuthResult | undefined> {
        if (!(await passkeyAutofillAvailable())) return undefined
        stopAutofill()
        const abort = new AbortController()
        autofillAbort = abort
        autofillActive.value = true
        let picked: PickedPasskey
        try {
            picked = await pickPasskey(abort)
        } catch (err) {
            // A dismissed or failed provider sheet ends the conditional request.
            return !abort.signal.aborted && isPasskeyCancel(err)
                ? autofill()
                : undefined
        }
        return passkeyLogin(picked)
    }

    function stopAutofill() {
        autofillAbort?.abort()
        autofillAbort = undefined
    }

    return { supported, autofillActive, signIn, autofill, stopAutofill }
}
