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

    async function signIn(
        options: { mfaId?: string; autofill?: AbortController } = {},
    ): Promise<AuthResult> {
        const ceremony = await pb.send<{ ceremony: string; options: unknown }>(
            '/api/auth/passkey/options',
            { method: 'POST' },
        )
        const credential = await getPasskey(ceremony.options, options.autofill)
        return pb.send<AuthResult>('/api/auth/passkey', {
            method: 'POST',
            body: {
                ceremony: ceremony.ceremony,
                credential,
                ...(options.mfaId && { mfaId: options.mfaId }),
            },
        })
    }

    async function autofill(): Promise<AuthResult | undefined> {
        if (!(await passkeyAutofillAvailable())) return undefined
        stopAutofill()
        const abort = new AbortController()
        autofillAbort = abort
        autofillActive.value = true
        try {
            return await signIn({ autofill: abort })
        } catch (err) {
            if (abort.signal.aborted) return undefined
            throw err
        }
    }

    function stopAutofill() {
        autofillAbort?.abort()
        autofillAbort = undefined
    }

    return { supported, autofillActive, signIn, autofill, stopAutofill }
}
