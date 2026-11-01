import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import OAuthSettings from '~/components/platform/OAuthSettings.vue'
import {
    listOAuthProviderSettings,
    saveOAuthProviderSettings,
    type OAuthProviderSettings,
} from '~/api/platform'
import { reauthenticate } from '~/api/account'
import { copyText } from '~/utils/clipboard'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useReauth } from '~/composables/useReauth'

vi.mock('~/api/platform', () => ({
    listOAuthProviderSettings: vi.fn(),
    saveOAuthProviderSettings: vi.fn(),
}))
vi.mock('~/api/account', () => ({ reauthenticate: vi.fn() }))
vi.mock('~/utils/clipboard', () => ({ copyText: vi.fn() }))

const success = vi.fn()
const error = vi.fn()

const provider = (
    overrides: Partial<OAuthProviderSettings> = {},
): OAuthProviderSettings => ({
    provider: 'google',
    enabled: true,
    client_id: 'gid',
    client_secret_set: true,
    display_name: '',
    issuer_url: '',
    tenant: '',
    team_id: '',
    key_id: '',
    private_key_set: false,
    redirect_uri: 'https://gripello.app/api/auth/oauth2/google/callback',
    ...overrides,
})

const providers = () => [
    provider(),
    provider({
        provider: 'apple',
        enabled: false,
        client_id: 'app.gripello',
        client_secret_set: false,
        team_id: 'TEAM',
        key_id: 'KEY',
        private_key_set: true,
        redirect_uri: 'https://gripello.app/api/auth/oauth2/apple/callback',
    }),
    provider({
        provider: 'microsoft',
        enabled: false,
        client_id: '',
        client_secret_set: false,
        tenant: 'contoso',
    }),
]

beforeEach(() => {
    success.mockReset()
    error.mockReset()
    vi.mocked(listOAuthProviderSettings)
        .mockReset()
        .mockResolvedValue(providers())
    vi.mocked(saveOAuthProviderSettings).mockReset()
    vi.mocked(reauthenticate)
        .mockReset()
        .mockResolvedValue(undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('useReauth', useReauth)
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('useNotification', () => ({ success, error }))
})

const field = {
    props: ['modelValue', 'placeholder'],
    emits: ['update:modelValue'],
    template: `<input v-bind="$attrs" :value="modelValue" :placeholder="placeholder"
        @input="$emit('update:modelValue', $event.target.value)" />`,
}

async function mountSettings() {
    const wrapper = mount(OAuthSettings, {
        global: {
            stubs: {
                LayoutPanel: { template: '<section><slot /></section>' },
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutEmptyState: {
                    template: '<p data-testid="load-error" />',
                },
                UFormField: {
                    props: ['label'],
                    template: '<label :data-field="label"><slot /></label>',
                },
                UInput: field,
                UTextarea: field,
                UIcon: true,
                UBadge: { template: '<span><slot /></span>' },
                USwitch: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" v-bind="$attrs" :checked="modelValue"
                        @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                },
                ConfirmDialog: {
                    props: ['modelValue', 'title'],
                    emits: ['confirm', 'update:modelValue'],
                    template: `<div v-if="modelValue" data-testid="confirm" :data-title="title">
                        <slot /><button data-testid="confirm-ok" @click="$emit('confirm')" />
                        <button data-testid="confirm-cancel" @click="$emit('update:modelValue', false)" />
                    </div>`,
                },
                UserReauthField: field,
            },
        },
    })
    await flushPromises()
    const get = (testId: string) => wrapper.get(`[data-testid="${testId}"]`)
    const has = (testId: string) =>
        wrapper.find(`[data-testid="${testId}"]`).exists()
    const secretField = (label: string) =>
        wrapper.get(
            `[data-field="platform.settings.oauth2.${label}"] input, [data-field="platform.settings.oauth2.${label}"] textarea`,
        )
    return { wrapper, get, has, secretField }
}

describe('PlatformOAuthSettings', () => {
    it('shows a load error instead of the list', async () => {
        vi.mocked(listOAuthProviderSettings).mockRejectedValue(
            new Error('down'),
        )
        const { has } = await mountSettings()
        expect(has('load-error')).toBe(true)
        expect(has('platform-oauth-google')).toBe(false)
    })

    it('shows each provider status and its client id or tenant', async () => {
        const { get } = await mountSettings()
        expect(get('platform-oauth-google').attributes('data-status')).toBe(
            'live',
        )
        expect(get('platform-oauth-apple').attributes('data-status')).toBe(
            'configured',
        )
        expect(get('platform-oauth-microsoft').attributes('data-status')).toBe(
            'missing',
        )
        expect(get('platform-oauth-google-toggle').text()).toContain('gid')
        expect(get('platform-oauth-microsoft-toggle').text()).toContain(
            'platform.settings.oauth2.status.missing',
        )
    })

    it('opens one provider at a time with its own fields and a hint for stored secrets', async () => {
        const { get, has, secretField } = await mountSettings()
        expect(has('platform-oauth-google-client-id')).toBe(false)
        await get('platform-oauth-google-toggle').trigger('click')
        expect(
            get('platform-oauth-google-toggle').attributes('aria-expanded'),
        ).toBe('true')
        expect(secretField('clientSecret').attributes('placeholder')).toBe(
            'platform.settings.mail.passwordSet',
        )
        expect(
            (secretField('clientSecret').element as HTMLInputElement).value,
        ).toBe('')

        await get('platform-oauth-apple-toggle').trigger('click')
        expect(has('platform-oauth-google-client-id')).toBe(false)
        expect(has('platform-oauth-apple-client-id')).toBe(true)
        expect(
            get('platform-oauth-apple')
                .find('[data-field="platform.settings.oauth2.clientSecret"]')
                .exists(),
        ).toBe(false)
        expect(secretField('privateKey').attributes('placeholder')).toBe(
            'platform.settings.mail.passwordSet',
        )
    })

    it('saves only after a password confirmation and keeps stored secrets when left blank', async () => {
        const { get, has } = await mountSettings()
        await get('platform-oauth-google-toggle').trigger('click')
        expect(
            get('platform-oauth-google-save').attributes('disabled'),
        ).toBeDefined()

        await get('platform-oauth-google-client-id').setValue('new-gid')
        await get('platform-oauth-google-save').trigger('click')
        expect(saveOAuthProviderSettings).not.toHaveBeenCalled()
        expect(get('confirm').attributes('data-title')).toBe(
            'platform.settings.oauth2.providers.google',
        )

        vi.mocked(saveOAuthProviderSettings).mockResolvedValue([
            provider({ client_id: 'new-gid' }),
        ])
        await get('platform-oauth-admin-password').setValue('hunter22')
        await get('confirm-ok').trigger('click')
        await flushPromises()

        expect(reauthenticate).toHaveBeenCalledWith('hunter22')
        expect(saveOAuthProviderSettings).toHaveBeenCalledWith('google', {
            enabled: true,
            client_id: 'new-gid',
            display_name: '',
            issuer_url: '',
            tenant: '',
            team_id: '',
            key_id: '',
        })
        expect(success).toHaveBeenCalledWith('settings.saveSuccess')
        expect(has('confirm')).toBe(false)
        expect(
            get('platform-oauth-google-save').attributes('disabled'),
        ).toBeDefined()
    })

    it('sends a typed secret', async () => {
        const { get, secretField } = await mountSettings()
        await get('platform-oauth-apple-toggle').trigger('click')
        await secretField('privateKey').setValue('-----BEGIN KEY-----')
        await get('platform-oauth-apple-save').trigger('click')
        vi.mocked(saveOAuthProviderSettings).mockResolvedValue(providers())
        await get('confirm-ok').trigger('click')
        await flushPromises()
        expect(saveOAuthProviderSettings).toHaveBeenCalledWith(
            'apple',
            expect.objectContaining({ private_key: '-----BEGIN KEY-----' }),
        )
    })

    it('keeps the form and the dialog open on a wrong password', async () => {
        const { get, has } = await mountSettings()
        await get('platform-oauth-google-toggle').trigger('click')
        await get('platform-oauth-google-client-id').setValue('new-gid')
        await get('platform-oauth-google-save').trigger('click')
        vi.mocked(reauthenticate).mockRejectedValue({
            response: { data: { password: { code: 'invalid_password' } } },
        })
        await get('confirm-ok').trigger('click')
        await flushPromises()

        expect(saveOAuthProviderSettings).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith('platform.users.adminPasswordWrong')
        expect(has('confirm')).toBe(true)
        expect(
            (get('platform-oauth-google-client-id').element as HTMLInputElement)
                .value,
        ).toBe('new-gid')
    })

    it('discards edits with cancel and clears the password when the dialog reopens', async () => {
        const { get } = await mountSettings()
        await get('platform-oauth-google-toggle').trigger('click')
        await get('platform-oauth-google-client-id').setValue('typo')
        await get('platform-oauth-google-save').trigger('click')
        await get('platform-oauth-admin-password').setValue('secret')
        await get('confirm-cancel').trigger('click')
        await get('platform-oauth-google-save').trigger('click')
        expect(
            (get('platform-oauth-admin-password').element as HTMLInputElement)
                .value,
        ).toBe('')
        await get('confirm-cancel').trigger('click')

        const cancel = get('platform-oauth-google')
            .findAll('button')
            .find((button) => button.text() === 'actions.cancel')!
        await cancel.trigger('click')
        expect(
            (get('platform-oauth-google-client-id').element as HTMLInputElement)
                .value,
        ).toBe('gid')
        expect(
            get('platform-oauth-google-save').attributes('disabled'),
        ).toBeDefined()
    })

    it('copies the redirect address', async () => {
        const { get } = await mountSettings()
        await get('platform-oauth-google-toggle').trigger('click')
        vi.mocked(copyText).mockResolvedValue(true)
        const copy = get('platform-oauth-google')
            .findAll('button')
            .find(
                (button) => button.text() === 'platform.settings.oauth2.copy',
            )!
        await copy.trigger('click')
        await flushPromises()
        expect(copyText).toHaveBeenCalledWith(
            'https://gripello.app/api/auth/oauth2/google/callback',
        )
        expect(success).toHaveBeenCalledWith('platform.settings.oauth2.copied')
    })
})
