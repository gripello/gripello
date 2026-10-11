import { describe, expect, it } from 'vitest'
import {
    oauth2ErrorKey,
    oauth2ProviderIcon,
    oauth2ProviderName,
} from '~/utils/oauth2'
import {
    oauthProviderForm,
    oauthProviderPayload,
    oauthProviderStatus,
    reloadedForm,
} from '~/utils/oauthSettings'

describe('oauth2 helpers', () => {
    it('names and draws the brands, the generic provider by its button name', () => {
        expect(oauth2ProviderName({ name: 'google', displayName: '' })).toBe(
            'Google',
        )
        expect(
            oauth2ProviderName({ name: 'oidc', displayName: 'Club login' }),
        ).toBe('Club login')
        expect(oauth2ProviderIcon('microsoft')).toBe('i-simple-icons-microsoft')
        expect(oauth2ProviderIcon('oidc')).toBe('i-lucide-log-in')
    })

    it('maps only known error codes from the redirect', () => {
        expect(oauth2ErrorKey('account_exists')).toBe(
            'auth.oauth2.errors.account_exists',
        )
        expect(oauth2ErrorKey('<script>')).toBe('auth.oauth2.errors.failed')
        expect(oauth2ErrorKey(['x'])).toBe('auth.oauth2.errors.failed')
    })
})

describe('oauth provider settings form', () => {
    const item = {
        provider: 'google' as const,
        enabled: true,
        client_id: 'id',
        client_secret_set: true,
        display_name: '',
        issuer_url: '',
        tenant: '',
        team_id: '',
        key_id: '',
        private_key_set: false,
        redirect_uri: 'https://x/api/auth/oauth2/google/callback',
    }

    it('sends secrets only when typed', () => {
        const form = oauthProviderForm(item)
        expect(oauthProviderPayload(form)).not.toHaveProperty('client_secret')
        expect(
            oauthProviderPayload({ ...form, client_secret: 'new' })
                .client_secret,
        ).toBe('new')
    })
})

describe('oauth provider status', () => {
    const base = {
        provider: 'google' as const,
        enabled: false,
        client_id: '',
        client_secret_set: false,
        display_name: '',
        issuer_url: '',
        tenant: '',
        team_id: '',
        key_id: '',
        private_key_set: false,
        redirect_uri: '',
    }

    it('is missing until client id and secret are saved, live once offered', () => {
        expect(oauthProviderStatus(base)).toBe('missing')
        const configured = { ...base, client_id: 'id', client_secret_set: true }
        expect(oauthProviderStatus(configured)).toBe('configured')
        expect(oauthProviderStatus({ ...configured, enabled: true })).toBe(
            'live',
        )
    })

    it('needs team, key and private key for Apple and an issuer for OIDC', () => {
        const apple = {
            ...base,
            provider: 'apple' as const,
            client_id: 'id',
            team_id: 't',
            key_id: 'k',
        }
        expect(oauthProviderStatus(apple)).toBe('missing')
        expect(oauthProviderStatus({ ...apple, private_key_set: true })).toBe(
            'configured',
        )
        expect(
            oauthProviderStatus({
                ...base,
                provider: 'oidc',
                client_id: 'id',
                client_secret_set: true,
            }),
        ).toBe('missing')
    })
})

describe('reloadedForm', () => {
    const item = {
        provider: 'google' as const,
        enabled: false,
        client_id: 'old',
        client_secret_set: false,
        display_name: '',
        issuer_url: '',
        tenant: '',
        team_id: '',
        key_id: '',
        private_key_set: false,
        redirect_uri: '',
    }

    it('keeps unsaved edits and refreshes untouched forms', () => {
        const fresh = { ...item, client_id: 'new' }
        const edited = { ...oauthProviderForm(item), client_id: 'typing' }
        expect(reloadedForm(edited, item, fresh).client_id).toBe('typing')
        expect(
            reloadedForm(oauthProviderForm(item), item, fresh).client_id,
        ).toBe('new')
        expect(reloadedForm(undefined, undefined, fresh).client_id).toBe('new')
    })
})
