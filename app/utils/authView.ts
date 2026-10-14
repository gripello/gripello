export const AUTH_VIEWS = [
    'login',
    'register',
    'requestReset',
    'resendVerification',
] as const

export type AuthView = (typeof AUTH_VIEWS)[number]

export function authView(query: unknown): AuthView {
    return AUTH_VIEWS.find((view) => view === query) ?? 'login'
}

const ONE_TIME_PARAMS = ['view', 'oauth2', 'oauth2Error', 'persistent']

export function authViewQuery<T>(
    query: Record<string, T>,
    view?: AuthView,
): Record<string, T | AuthView> {
    const kept = Object.fromEntries(
        Object.entries(query).filter(([key]) => !ONE_TIME_PARAMS.includes(key)),
    )
    return view && view !== 'login' ? { ...kept, view } : kept
}

export function requiresSignIn(middleware: unknown) {
    return [middleware].flat().includes('auth')
}
