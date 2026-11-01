import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, watch } from 'vue'
import LinkedAccounts from '~/components/account/LinkedAccounts.vue'
import {
    listLinkedAccounts,
    reauthenticate,
    unlinkAccount,
} from '~/api/account'
import { finishOAuth2Link, listAuthMethods, startOAuth2 } from '~/api/auth'
import { openSignInPage } from '~/utils/native'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useReauth } from '~/composables/useReauth'

vi.mock('~/api/account', () => ({
    listLinkedAccounts: vi.fn(),
    unlinkAccount: vi.fn(),
    reauthenticate: vi.fn(),
}))
vi.mock('~/api/auth', () => ({
    finishOAuth2Link: vi.fn(),
    listAuthMethods: vi.fn(),
    startOAuth2: vi.fn(),
}))
vi.mock('~/utils/native', () => ({ openSignInPage: vi.fn() }))

const notifyError = vi.fn()
const notifySuccess = vi.fn()
const replace = vi.fn()
let query: Record<string, string> = {}

beforeEach(() => {
    query = {}
    notifyError.mockReset()
    notifySuccess.mockReset()
    replace.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listLinkedAccounts)
        .mockReset()
        .mockResolvedValue({
            items: [
                {
                    id: 'i1',
                    provider: 'google',
                    email: 'me@gmail.test',
                    created: '',
                },
            ],
            hasPassword: true,
        })
    vi.mocked(listAuthMethods)
        .mockReset()
        .mockResolvedValue({
            oauth2: {
                providers: [{ name: 'google' }, { name: 'microsoft' }],
            },
        } as never)
    vi.mocked(startOAuth2)
        .mockReset()
        .mockResolvedValue({ url: 'https://login.test/start' } as never)
    vi.mocked(reauthenticate)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(unlinkAccount)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(finishOAuth2Link)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(openSignInPage).mockReset().mockResolvedValue()
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useReauth', useReauth)
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('useNotification', () => ({
        success: notifySuccess,
        error: notifyError,
    }))
    vi.stubGlobal('useRoute', () => ({ query }))
    vi.stubGlobal('useRouter', () => ({ replace }))
    vi.stubGlobal('useAccountChanges', vi.fn())
})

async function mountAccounts() {
    const wrapper = mount(LinkedAccounts, {
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutEyebrow: true,
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: { template: '<li><slot /></li>' },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
                UserReauthField: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input data-testid="linked-account-password" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                ConfirmDialog: {
                    props: ['modelValue', 'title'],
                    emits: ['confirm', 'update:modelValue'],
                    template: `<div v-if="modelValue" :data-testid="'confirm-' + title"><slot />
                        <button data-testid="confirm" @click="$emit('confirm')" />
                        <button data-testid="cancel" @click="$emit('update:modelValue', false)" /></div>`,
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

const linkDialog = '[data-testid="confirm-account.linkedAccounts.link"]'
const unlinkDialog = '[data-testid="confirm-account.linkedAccounts.unlink"]'

describe('LinkedAccounts', () => {
    it('offers linking only for providers not linked yet', async () => {
        const wrapper = await mountAccounts()
        expect(
            wrapper.find('[data-testid="linked-account-google"]').exists(),
        ).toBe(true)
        expect(
            wrapper.find('[data-testid="linked-account-link-google"]').exists(),
        ).toBe(false)
        expect(
            wrapper
                .find('[data-testid="linked-account-link-microsoft"]')
                .exists(),
        ).toBe(true)
    })

    it('confirms the password before linking an account that has one', async () => {
        const wrapper = await mountAccounts()
        await wrapper
            .get('[data-testid="linked-account-link-microsoft"]')
            .trigger('click')
        expect(startOAuth2).not.toHaveBeenCalled()

        await wrapper
            .get('[data-testid="linked-account-password"]')
            .setValue('secret')
        await wrapper
            .get(linkDialog)
            .get('[data-testid="confirm"]')
            .trigger('click')
        await flushPromises()
        expect(reauthenticate).toHaveBeenCalledWith('secret')
        expect(startOAuth2).toHaveBeenCalledWith('microsoft', { link: true })
        expect(openSignInPage).toHaveBeenCalledWith('https://login.test/start')
        expect(
            vi.mocked(reauthenticate).mock.invocationCallOrder[0],
        ).toBeLessThan(vi.mocked(startOAuth2).mock.invocationCallOrder[0]!)
    })

    it('never starts linking after a wrong password', async () => {
        vi.mocked(reauthenticate).mockRejectedValue({
            response: { data: { password: { code: 'invalid_password' } } },
        })
        const wrapper = await mountAccounts()
        await wrapper
            .get('[data-testid="linked-account-link-microsoft"]')
            .trigger('click')
        await wrapper
            .get(linkDialog)
            .get('[data-testid="confirm"]')
            .trigger('click')
        await flushPromises()
        expect(startOAuth2).not.toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith(
            'platform.users.adminPasswordWrong',
        )
        expect(wrapper.find(linkDialog).exists()).toBe(true)
    })

    it('clears the password each time the link dialog opens', async () => {
        const wrapper = await mountAccounts()
        const open = () =>
            wrapper
                .get('[data-testid="linked-account-link-microsoft"]')
                .trigger('click')
        await open()
        await wrapper
            .get('[data-testid="linked-account-password"]')
            .setValue('typo')
        await wrapper
            .get(linkDialog)
            .get('[data-testid="cancel"]')
            .trigger('click')
        await open()
        expect(
            (
                wrapper.get('[data-testid="linked-account-password"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('')
    })

    it('links straight away for an account without a password', async () => {
        vi.mocked(listLinkedAccounts).mockResolvedValue({
            items: [],
            hasPassword: false,
        })
        const wrapper = await mountAccounts()
        await wrapper
            .get('[data-testid="linked-account-link-google"]')
            .trigger('click')
        await flushPromises()
        expect(wrapper.find(linkDialog).exists()).toBe(false)
        expect(reauthenticate).not.toHaveBeenCalled()
        expect(startOAuth2).toHaveBeenCalledWith('google', { link: true })
    })

    it('refuses to unlink the last way to sign in and keeps the dialog', async () => {
        vi.mocked(unlinkAccount).mockRejectedValue({ status: 409 })
        const wrapper = await mountAccounts()
        await wrapper
            .get('[data-testid="linked-account-unlink-google"]')
            .trigger('click')
        await wrapper
            .get(unlinkDialog)
            .get('[data-testid="confirm"]')
            .trigger('click')
        await flushPromises()
        expect(unlinkAccount).toHaveBeenCalledWith('i1')
        expect(notifyError).toHaveBeenCalledWith(
            'account.linkedAccounts.lastMethod',
        )
        expect(wrapper.find(unlinkDialog).exists()).toBe(true)
    })

    it('unlinks and reloads the list', async () => {
        const wrapper = await mountAccounts()
        vi.mocked(listLinkedAccounts).mockResolvedValue({
            items: [],
            hasPassword: true,
        })
        await wrapper
            .get('[data-testid="linked-account-unlink-google"]')
            .trigger('click')
        await wrapper
            .get(unlinkDialog)
            .get('[data-testid="confirm"]')
            .trigger('click')
        await flushPromises()
        expect(wrapper.find(unlinkDialog).exists()).toBe(false)
        expect(
            wrapper.find('[data-testid="linked-account-google"]').exists(),
        ).toBe(false)
        expect(
            wrapper.find('[data-testid="linked-account-link-google"]').exists(),
        ).toBe(true)
    })

    it('redeems a link ticket from the provider callback and strips it from the url', async () => {
        query = { oauth2Link: 'ticket-1', tab: 'security' }
        await mountAccounts()
        expect(replace).toHaveBeenCalledWith({ query: { tab: 'security' } })
        expect(finishOAuth2Link).toHaveBeenCalledWith('ticket-1')
        expect(notifySuccess).toHaveBeenCalledWith(
            'account.linkedAccounts.linked',
        )
    })

    it.each([
        [
            { oauth2Error: 'already_linked' },
            'auth.oauth2.errors.already_linked',
        ],
        [{ oauth2Error: '<script>' }, 'auth.oauth2.errors.failed'],
    ])('shows a known callback error and nothing else', async (q, key) => {
        query = q
        await mountAccounts()
        expect(notifyError).toHaveBeenCalledWith(key)
        expect(finishOAuth2Link).not.toHaveBeenCalled()
    })

    it('reports why a link ticket was refused', async () => {
        vi.mocked(finishOAuth2Link).mockRejectedValue({
            response: { data: { ticket: { code: 'account_exists' } } },
        })
        query = { oauth2Link: 'ticket-1' }
        await mountAccounts()
        expect(notifyError).toHaveBeenCalledWith(
            'auth.oauth2.errors.account_exists',
        )
        expect(notifySuccess).not.toHaveBeenCalled()
    })
})
