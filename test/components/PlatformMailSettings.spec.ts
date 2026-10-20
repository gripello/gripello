import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import MailSettings from '~/components/platform/MailSettings.vue'
import { useReauth } from '~/composables/useReauth'

const getMailSettings = vi.fn()
vi.mock('~/api/platform', () => ({
    getMailSettings: () => getMailSettings(),
    sendTestMail: vi.fn(),
    updateMailSettings: vi.fn(),
}))
vi.mock('~/api/account', () => ({ reauthenticate: vi.fn() }))

const stored = (host: string) => ({
    source: 'database',
    smtp_host: host,
    smtp_port: 587,
    smtp_username: '',
    smtp_password_set: false,
    smtp_tls: false,
    sender_address: '',
    sender_name: '',
})

const inputStub = {
    props: ['modelValue'],
    template:
        '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
}

describe('PlatformMailSettings', () => {
    beforeEach(() => {
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('useReauth', useReauth)
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: vi.fn(),
        }))
    })

    it('keeps unsaved edits when the settings reload', async () => {
        getMailSettings.mockResolvedValue(stored('smtp.one'))
        const wrapper = mount(MailSettings, {
            global: {
                stubs: {
                    LayoutPanel: { template: '<div><slot /></div>' },
                    UForm: { template: '<form><slot /></form>' },
                    UFormField: { template: '<div><slot /></div>' },
                    UInput: inputStub,
                    UInputNumber: true,
                    UBadge: true,
                    UButton: true,
                    UIcon: true,
                    SegmentedControl: true,
                    ConfirmDialog: true,
                    LayoutEmptyState: true,
                },
            },
        })
        await flushPromises()
        const host = wrapper.get('[data-testid="platform-mail-host"]')
        expect((host.element as HTMLInputElement).value).toBe('smtp.one')

        await host.setValue('smtp.edited')
        getMailSettings.mockResolvedValue(stored('smtp.two'))
        await (
            wrapper.vm as unknown as { refresh: () => Promise<void> }
        ).refresh()
        await flushPromises()

        expect((host.element as HTMLInputElement).value).toBe('smtp.edited')
        expect(
            (wrapper.vm as unknown as { hasChanges: boolean }).hasChanges,
        ).toBe(true)
    })

    it('lays the form fields out in the two-column settings grid', () => {
        const source = readFileSync(
            'app/components/platform/MailSettings.vue',
            'utf8',
        )
        expect(source).toMatch(
            /<UForm[^>]*:class="SETTINGS_FIELDS_GRID"[^>]*@submit="askPassword"/,
        )
        expect(source.match(/SETTINGS_FIELDS_GRID"/g)).toHaveLength(1)
        expect(source).toMatch(
            /ring-default lg:col-span-2"\s+data-testid="platform-mail-check"/,
        )
    })
})
