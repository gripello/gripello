const PROVIDER_ICONS: Record<string, string> = {
    google: 'i-simple-icons-google',
    apple: 'i-simple-icons-apple',
    microsoft: 'i-simple-icons-microsoft',
}

export function oauth2ProviderIcon(provider: string) {
    return PROVIDER_ICONS[provider] ?? 'i-lucide-log-in'
}

const PROVIDER_NAMES: Record<string, string> = {
    google: 'Google',
    apple: 'Apple',
    microsoft: 'Microsoft',
}

// Brand names stay untranslated; the generic OIDC provider shows the name the platform admin gave it.
export function oauth2ProviderName(provider: {
    name: string
    displayName?: string
}) {
    return (
        provider.displayName || PROVIDER_NAMES[provider.name] || provider.name
    )
}

export const OAUTH2_ERRORS = [
    'failed',
    'registration_disabled',
    'account_exists',
    'already_linked',
    'email_unverified',
] as const

export function oauth2ErrorKey(code: unknown) {
    const known = OAUTH2_ERRORS.find((error) => error === code)
    return `auth.oauth2.errors.${known ?? 'failed'}`
}
