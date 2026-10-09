type PasskeyCredentialStatic = typeof PublicKeyCredential & {
    isConditionalMediationAvailable?: () => Promise<boolean>
    parseCreationOptionsFromJSON?: (
        options: unknown,
    ) => PublicKeyCredentialCreationOptions
    parseRequestOptionsFromJSON?: (
        options: unknown,
    ) => PublicKeyCredentialRequestOptions
}

type JsonCredential = PublicKeyCredential & { toJSON: () => unknown }

function passkeyApi(): PasskeyCredentialStatic | undefined {
    return typeof window === 'undefined'
        ? undefined
        : (window.PublicKeyCredential as PasskeyCredentialStatic | undefined)
}

export function passkeysSupported() {
    const api = passkeyApi()
    return (
        !!api?.parseCreationOptionsFromJSON &&
        !!api.parseRequestOptionsFromJSON &&
        !!navigator.credentials
    )
}

export async function passkeyAutofillAvailable() {
    return (
        passkeysSupported() &&
        !!(await passkeyApi()!
            .isConditionalMediationAvailable?.()
            .catch(() => false))
    )
}

export function isPasskeyCancel(err: unknown) {
    return (
        err instanceof DOMException &&
        ['NotAllowedError', 'AbortError'].includes(err.name)
    )
}

export async function createPasskey(options: unknown) {
    const publicKey = passkeyApi()!.parseCreationOptionsFromJSON!(options)
    const credential = (await navigator.credentials.create({
        publicKey,
    })) as JsonCredential
    return credential.toJSON()
}

export async function getPasskey(
    options: unknown,
    autofill?: { signal: AbortSignal },
) {
    const publicKey = passkeyApi()!.parseRequestOptionsFromJSON!(options)
    const credential = (await navigator.credentials.get({
        publicKey,
        ...(autofill && {
            mediation: 'conditional' as CredentialMediationRequirement,
            signal: autofill.signal,
        }),
    })) as JsonCredential
    return credential.toJSON()
}
