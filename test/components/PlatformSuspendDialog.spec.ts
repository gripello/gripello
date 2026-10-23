import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import SuspendDialog from '~/components/platform/SuspendDialog.vue'
import { hideAuthorContent } from '~/api/moderation'
import { getBlockSuggestions, suspendUser } from '~/api/platform'
import { reauthenticate } from '~/api/account'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { useReauth } from '~/composables/useReauth'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/moderation', () => ({ hideAuthorContent: vi.fn() }))
vi.mock('~/api/account', () => ({ reauthenticate: vi.fn() }))
vi.mock('~/api/platform', () => ({
    addBlockedEmails: vi.fn(),
    getBlockSuggestions: vi.fn(),
    liftSuspension: vi.fn(),
    suspendUser: vi.fn(),
}))

const modelStub = (tag: string, checked = false) => ({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: checked
        ? `<${tag} type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />`
        : `<${tag} :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
})

describe('PlatformSuspendDialog', () => {
    const notifyError = vi.fn()

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('useReauth', useReauth)
        vi.stubGlobal('useAsyncAction', useAsyncAction)
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: notifyError,
        }))
        vi.mocked(getBlockSuggestions).mockResolvedValue(
            null as unknown as Awaited<ReturnType<typeof getBlockSuggestions>>,
        )
    })

    it('retries only the step that failed after the suspension went through', async () => {
        vi.mocked(hideAuthorContent)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(
                undefined as unknown as Awaited<
                    ReturnType<typeof hideAuthorContent>
                >,
            )
        const wrapper = mount(SuspendDialog, {
            props: {
                modelValue: false,
                user: { id: 'u1', username: 'kim' } as never,
            },
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    LayoutDialogShell: dialogShellStub,
                    UFormField: { template: '<div><slot /></div>' },
                    UTextarea: modelStub('textarea'),
                    UCheckbox: modelStub('input', true),
                    UserReauthField: modelStub('input'),
                    OptionGrid: true,
                    UButton: true,
                },
            },
        })
        await wrapper.setProps({ modelValue: true })
        await wrapper
            .get('[data-testid="platform-suspend-reason"]')
            .setValue('spam')
        await wrapper
            .get('[data-testid="platform-suspend-hide-content"]')
            .setValue(true)
        await wrapper
            .get('[data-testid="platform-suspend-admin-password"]')
            .setValue('secret')
        const confirm = wrapper.get('[data-testid="platform-suspend-confirm"]')

        await confirm.trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalledWith(
            'platform.users.hideContentFailed',
        )
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
        expect(
            wrapper.get('[data-testid="platform-suspend-reason"]').attributes(),
        ).toHaveProperty('disabled')

        await confirm.trigger('click')
        await flushPromises()

        expect(reauthenticate).toHaveBeenCalledTimes(1)
        expect(suspendUser).toHaveBeenCalledTimes(1)
        expect(hideAuthorContent).toHaveBeenCalledTimes(2)
        expect(wrapper.emitted('changed')).toHaveLength(1)
    })
})
