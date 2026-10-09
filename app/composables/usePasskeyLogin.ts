import type { RecordModel } from 'pocketbase'
import {
    getPasskey,
    passkeyAutofillAvailable,
    passkeysSupported,
} from '~/utils/webauthn'

export type AuthResult = { token: string; record: RecordModel }

export function usePasskeyLogin() {
    const pb = usePocketbase()
    const supported = ref(false)
    const autofillActive = ref(false)
    let autofillAbort: AbortController | undefined

    onMounted(() => (supported.value = passkeysSupported()))
    onBeforeUnmount(() => autofillAbort?.abort())

    async function pickPasskey(autofill?: AbortController) {
        const ceremony = await pb.send<{ ceremony: string; options: unknown }>(
            '/api/auth/passkey/options',
            { method: 'POST' },
        )
        const credential = await getPasskey(ceremony.options, autofill)
        return { ceremony: ceremony.ceremony, credential }
    }

    function verify(
        picked: { ceremony: string; credential: unknown },
        mfaId?: string,
    ) {
        return pb.send<AuthResult>('/api/auth/passkey', {
            method: 'POST',
            body: { ...picked, ...(mfaId && { mfaId }) },
        })
    }

    async function signIn(options: { mfaId?: string } = {}) {
        return verify(await pickPasskey(), options.mfaId)
    }

    async function autofill(): Promise<AuthResult | undefined> {
        if (!(await passkeyAutofillAvailable())) return undefined
        stopAutofill()
        const abort = new AbortController()
        autofillAbort = abort
        autofillActive.value = true
        const picked = await pickPasskey(abort).catch(() => undefined)
        return picked && verify(picked)
    }

    function stopAutofill() {
        autofillAbort?.abort()
        autofillAbort = undefined
    }

    return { supported, autofillActive, signIn, autofill, stopAutofill }
}
