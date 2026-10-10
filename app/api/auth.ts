import type { ApiRecord, AuthRecord, AuthStore } from '~/composables/authStore'
import { useApi } from './client'

export type AuthResult = { token: string; record: ApiRecord }
export type SecondFactorMethod = 'totp' | 'passkey' | 'recovery'

export interface MFARequired {
    mfaId: string
    methods: SecondFactorMethod[]
}

export interface PasskeyCeremony {
    ceremony: string
    options: unknown
}

export interface PickedPasskey {
    ceremony: string
    credential: unknown
}

export interface RegisterInput {
    email: string
    password: string
    passwordConfirm: string
    username?: string
    firstname?: string
    name?: string
    language?: string
}

type Headers = Record<string, string>

export function useAuthState(store: AuthStore = useAuthStore()) {
    return {
        currentUserId: () => store.record?.id ?? '',
        currentUser: <T = NonNullable<AuthRecord>>() =>
            store.record as T | null,
        token: () => store.token,
        isSignedIn: () => store.isValid,
        onAuthChange: (
            callback: (token: string, record: AuthRecord) => void,
            fireImmediately?: boolean,
        ) => store.onChange(callback, fireImmediately),
        saveAuth: ({ token, record }: AuthResult) => store.save(token, record),
        saveUser: (record: AuthRecord) => store.save(store.token, record),
        clearAuth: () => store.clear(),
    }
}

async function signIn(request: Promise<AuthResult>) {
    const result = await request
    useAuthState().saveAuth(result)
    return result
}

export function login(identity: string, password: string, headers?: Headers) {
    return signIn(
        useApi()<AuthResult>('/auth/login', {
            method: 'POST',
            body: { identity, password },
            headers,
        }),
    )
}

export function mfaRequired(error: unknown): MFARequired | null {
    const response = (
        error as {
            response?: { mfaId?: string; methods?: SecondFactorMethod[] }
        }
    )?.response
    if (!response?.mfaId) return null
    return {
        mfaId: response.mfaId,
        methods: response.methods?.length
            ? response.methods
            : ['totp', 'recovery'],
    }
}

function post<T = void>(path: string, body?: object, headers?: Headers) {
    return useApi()<T>(path, { method: 'POST', body, headers })
}

export function loginWithTOTP(mfaId: string, code: string) {
    return post<AuthResult>('/auth/totp', { mfaId, code })
}

export function loginWithRecoveryCode(mfaId: string, code: string) {
    return post<AuthResult>('/auth/recovery', { mfaId, code })
}

export function passkeyLoginOptions() {
    return post<PasskeyCeremony>('/auth/passkey/options')
}

export function passkeyLogin(picked: PickedPasskey, mfaId?: string) {
    return post<AuthResult>('/auth/passkey', {
        ...picked,
        ...(mfaId && { mfaId }),
    })
}

export function refreshAuth() {
    return signIn(post<AuthResult>('/auth/refresh'))
}

export function logout(store: AuthStore = useAuthStore()) {
    const token = store.token
    store.clear()
    if (token)
        post('/auth/logout', undefined, {
            Authorization: `Bearer ${token}`,
        }).catch(() => {})
}

export async function register(input: RegisterInput, headers?: Headers) {
    await post('/auth/register', input, headers)
    return { verificationSent: true }
}

export function requestPasswordReset(email: string, headers?: Headers) {
    return post('/auth/password-reset/request', { email }, headers)
}

export function confirmPasswordReset(
    token: string,
    password: string,
    passwordConfirm: string,
) {
    return post('/auth/password-reset/confirm', {
        token,
        password,
        passwordConfirm,
    })
}

export function requestVerification(email: string, headers?: Headers) {
    return post('/auth/verification/request', { email }, headers)
}

export function confirmVerification(token: string) {
    return post('/auth/verification/confirm', { token })
}

export function requestEmailChange(newEmail: string) {
    return post('/auth/email-change/request', { newEmail })
}

export function confirmEmailChange(token: string, password: string) {
    return post('/auth/email-change/confirm', { token, password })
}
