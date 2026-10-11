import type { OAuthProviderInput, OAuthProviderSettings } from '~/api/platform'

export interface OAuthProviderForm {
    enabled: boolean
    client_id: string
    client_secret: string
    display_name: string
    issuer_url: string
    tenant: string
    team_id: string
    key_id: string
    private_key: string
}

export function oauthProviderForm(
    item: OAuthProviderSettings,
): OAuthProviderForm {
    return {
        enabled: item.enabled,
        client_id: item.client_id,
        client_secret: '',
        display_name: item.display_name,
        issuer_url: item.issuer_url,
        tenant: item.tenant,
        team_id: item.team_id,
        key_id: item.key_id,
        private_key: '',
    }
}

// Secret fields are sent only when typed, so saving other fields keeps the stored secrets.
export function oauthProviderPayload(
    form: OAuthProviderForm,
): OAuthProviderInput {
    const { client_secret, private_key, ...rest } = form
    return {
        ...rest,
        ...(client_secret && { client_secret }),
        ...(private_key && { private_key }),
    }
}

export type OAuthProviderStatus = 'live' | 'configured' | 'missing'

export function oauthProviderChecks(item: OAuthProviderSettings) {
    const secret =
        item.provider === 'apple'
            ? !!item.team_id && !!item.key_id && item.private_key_set
            : item.client_secret_set
    return {
        clientId:
            !!item.client_id && (item.provider !== 'oidc' || !!item.issuer_url),
        secret,
        live: item.enabled,
    }
}

export function oauthProviderStatus(
    item: OAuthProviderSettings,
): OAuthProviderStatus {
    const checks = oauthProviderChecks(item)
    if (!checks.clientId || !checks.secret) return 'missing'
    return checks.live ? 'live' : 'configured'
}

// The form to show after the provider list reloads: unsaved edits survive, untouched forms take the new values.
export function reloadedForm(
    form: OAuthProviderForm | undefined,
    before: OAuthProviderSettings | undefined,
    item: OAuthProviderSettings,
) {
    const untouched =
        !form ||
        !before ||
        JSON.stringify(form) === JSON.stringify(oauthProviderForm(before))
    return untouched ? oauthProviderForm(item) : form
}
