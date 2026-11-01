import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import BlocklistSettings from '~/components/platform/BlocklistSettings.vue'
import {
    getBlocklists,
    setEmailSource,
    syncEmailSource,
    updateBlocklists,
    type BlocklistSettings as Settings,
    type EmailSource,
} from '~/api/platform'
import { useAsyncAction } from '~/composables/useAsyncAction'

vi.mock('~/api/platform', () => ({
    getBlocklists: vi.fn(),
    setEmailSource: vi.fn(),
    syncEmailSource: vi.fn(),
    updateBlocklists: vi.fn(),
}))

const success = vi.fn()
const error = vi.fn()

const source = (overrides: Partial<EmailSource> = {}): EmailSource => ({
    id: 'disposable',
    name: 'Disposable',
    homepage: 'https://example.org',
    license: 'CC0',
    enabled: false,
    synced_at: null,
    attempted_at: null,
    domain_count: 0,
    last_error: '',
    ...overrides,
})

const stored = (overrides: Partial<Settings> = {}): Settings => ({
    blocked_emails: ['spam.example'],
    allowed_emails: ['coach@spam.example'],
    protected_names: ['Gripello'],
    sources: [source()],
    ...overrides,
})

beforeEach(() => {
    success.mockReset()
    error.mockReset()
    vi.mocked(getBlocklists).mockReset().mockResolvedValue(stored())
    vi.mocked(updateBlocklists).mockReset()
    vi.mocked(setEmailSource).mockReset()
    vi.mocked(syncEmailSource).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal('useNotification', () => ({ success, error }))
})

const textarea = {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<textarea v-bind="$attrs" :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)" />`,
}

async function mountSettings() {
    const wrapper = mount(BlocklistSettings, {
        global: {
            stubs: {
                UForm: {
                    emits: ['submit'],
                    setup(_, { expose, emit }) {
                        const errors = ref<{ name: string; message: string }[]>(
                            [],
                        )
                        expose({
                            setErrors: (next: typeof errors.value) =>
                                (errors.value = next),
                            submit: () => emit('submit'),
                        })
                        return { errors }
                    },
                    template: `<form><slot />
                        <p v-for="item in errors" :key="item.name" :data-error="item.name">{{ item.message }}</p>
                    </form>`,
                },
                LayoutPanel: { template: '<section><slot /></section>' },
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                LayoutListRow: {
                    template: '<li v-bind="$attrs"><slot /></li>',
                },
                LayoutEyebrow: true,
                LayoutEmptyState: {
                    template: '<p data-testid="load-error" />',
                },
                UFormField: { template: '<div><slot /></div>' },
                UTextarea: textarea,
                UBadge: true,
                ULink: { template: '<a><slot /></a>' },
                USwitch: {
                    props: ['modelValue', 'disabled'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" v-bind="$attrs" :checked="modelValue" :disabled="disabled"
                        @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')" />',
                },
                PlatformBlocklistCheck: {
                    props: ['kind', 'lists', 'sources'],
                    template: '<div :data-check="kind" />',
                },
                PlatformEmailSourceDialog: {
                    props: ['modelValue', 'source'],
                    template:
                        '<div data-testid="source-dialog" :data-open="modelValue" :data-source="source?.id" />',
                },
            },
        },
    })
    await flushPromises()
    const vm = wrapper.vm as unknown as {
        submit: () => void
        hasChanges: boolean
    }
    const get = (testId: string) => wrapper.get(`[data-testid="${testId}"]`)
    const check = (kind: string) =>
        wrapper.getComponent(`[data-check="${kind}"]`)
    return { wrapper, vm, get, check }
}

describe('PlatformBlocklistSettings', () => {
    it('shows a load error instead of the form', async () => {
        vi.mocked(getBlocklists).mockRejectedValue(new Error('down'))
        const { wrapper } = await mountSettings()
        expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
        expect(
            wrapper
                .find('[data-testid="platform-blocklist-settings"]')
                .exists(),
        ).toBe(false)
    })

    it('hands the unsaved lists to both testers and saves them line by line', async () => {
        const { vm, get, check } = await mountSettings()
        expect(
            (get('platform-blocklist-emails').element as HTMLTextAreaElement)
                .value,
        ).toBe('spam.example')

        await get('platform-blocklist-emails').setValue(
            'spam.example\n  *.junk.example  \n\n',
        )
        await get('platform-blocklist-names').setValue('')
        const lists = {
            blocked_emails: ['spam.example', '*.junk.example'],
            allowed_emails: ['coach@spam.example'],
            protected_names: [],
        }
        expect(check('email').props('lists')).toEqual(lists)
        expect(check('name').props('lists')).toEqual(lists)
        expect(vm.hasChanges).toBe(true)

        vi.mocked(updateBlocklists).mockResolvedValue(stored(lists))
        vm.submit()
        await flushPromises()
        expect(updateBlocklists).toHaveBeenCalledWith(lists)
        expect(success).toHaveBeenCalledWith('settings.saveSuccess')
        expect(vm.hasChanges).toBe(false)
    })

    it('marks the entries the server refused on their field and keeps the input', async () => {
        const { wrapper, vm, get } = await mountSettings()
        await get('platform-blocklist-allowed').setValue(
            'ok@club.example\nnot an address',
        )
        vi.mocked(updateBlocklists).mockRejectedValue({
            response: {
                data: { 'allowed_emails.1': { code: 'validation_invalid' } },
            },
        })
        vm.submit()
        await flushPromises()

        expect(wrapper.get('[data-error="allowed_emails"]').text()).toBe(
            'platform.settings.blocklists.invalid',
        )
        expect(wrapper.find('[data-error="blocked_emails"]').exists()).toBe(
            false,
        )
        expect(error).toHaveBeenCalledWith('settings.saveError')
        expect(
            (get('platform-blocklist-allowed').element as HTMLTextAreaElement)
                .value,
        ).toBe('ok@club.example\nnot an address')
        expect(vm.hasChanges).toBe(true)
    })

    it('applies a source toggle at once without dropping unsaved list edits', async () => {
        const { vm, get } = await mountSettings()
        await get('platform-blocklist-emails').setValue('edited.example')

        let finish!: (settings: Settings) => void
        vi.mocked(setEmailSource).mockReturnValue(
            new Promise((resolve) => (finish = resolve)),
        )
        await get('platform-email-source-toggle-disposable').setValue(true)
        expect(setEmailSource).toHaveBeenCalledWith('disposable', true)
        expect(
            get('platform-email-source-toggle-disposable').attributes(
                'disabled',
            ),
        ).toBeDefined()
        expect(
            get('platform-email-source-sync-disposable').attributes('disabled'),
        ).toBeDefined()

        finish(
            stored({
                blocked_emails: [],
                protected_names: ['Changed elsewhere'],
                sources: [
                    source({
                        enabled: true,
                        domain_count: 4000,
                        synced_at: '2026-10-01T00:00:00.000Z',
                    }),
                ],
            }),
        )
        await flushPromises()
        const toggle = get('platform-email-source-toggle-disposable')
        expect((toggle.element as HTMLInputElement).checked).toBe(true)
        expect(toggle.attributes('disabled')).toBeUndefined()
        expect(
            (get('platform-blocklist-emails').element as HTMLTextAreaElement)
                .value,
        ).toBe('edited.example')
        expect(
            (get('platform-blocklist-names').element as HTMLTextAreaElement)
                .value,
        ).toBe('Gripello')
        expect(vm.hasChanges).toBe(true)
    })

    it('reports a failed sync and shows the stored source error', async () => {
        vi.mocked(getBlocklists).mockResolvedValue(
            stored({ sources: [source({ last_error: 'HTTP 503' })] }),
        )
        const { get } = await mountSettings()
        expect(get('platform-email-source-error-disposable').text()).toBe(
            'HTTP 503',
        )
        vi.mocked(syncEmailSource).mockRejectedValue(new Error('down'))
        await get('platform-email-source-sync-disposable').trigger('click')
        await flushPromises()
        expect(error).toHaveBeenCalledWith('settings.saveError')
        expect(
            get('platform-email-source-sync-disposable').attributes('disabled'),
        ).toBeUndefined()
    })

    it('opens the domain list only for a source that has domains', async () => {
        vi.mocked(getBlocklists).mockResolvedValue(
            stored({
                sources: [
                    source(),
                    source({
                        id: 'checker',
                        name: 'Checker',
                        domain_count: 12,
                    }),
                ],
            }),
        )
        const { get } = await mountSettings()
        expect(
            get('platform-email-source-view-disposable').attributes('disabled'),
        ).toBeDefined()
        await get('platform-email-source-view-checker').trigger('click')
        expect(get('source-dialog').attributes('data-open')).toBe('true')
        expect(get('source-dialog').attributes('data-source')).toBe('checker')
    })
})
