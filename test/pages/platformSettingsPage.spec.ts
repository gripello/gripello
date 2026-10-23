import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, reactive, ref, watch } from 'vue'
import SettingsPage from '~/pages/platform/settings.vue'
import { updateSettings } from '~/api/gyms'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { legalFieldsFrom, legalPayload } from '~/utils/legalFields'

vi.mock('~/api/gyms', () => ({ updateSettings: vi.fn() }))

const query = reactive<Record<string, string>>({})
const selectSection = vi.fn()
const mailDirty = ref(false)
const layoutProps = reactive<{ unsavedChanges?: boolean }>({})
const settings = ref({
    allow_registration: false,
    audit_retention_days: 90,
    contact_email: 'ops@example.com',
})

const editorStub = (name: string, dirty = ref(false)) => ({
    name,
    setup(_: unknown, { expose }: { expose: (api: object) => void }) {
        expose({ hasChanges: dirty, saving: false, submit: vi.fn() })
        return {}
    },
    template: `<div data-testid="${name}" />`,
})

const formStub = {
    name: 'UForm',
    emits: ['submit', 'error'],
    setup(_: unknown, { expose }: { expose: (api: object) => void }) {
        expose({ submit: vi.fn(), setErrors: vi.fn() })
    },
    template: '<form><slot /></form>',
}

async function mountPage() {
    const wrapper = mount(
        defineComponent({
            components: { SettingsPage },
            template: '<Suspense><SettingsPage /></Suspense>',
        }),
        {
            global: {
                mocks: { $t: (key: string) => key },
                stubs: {
                    SettingsLayout: {
                        props: ['unsavedChanges'],
                        setup(props: { unsavedChanges?: boolean }) {
                            watch(
                                () => props.unsavedChanges,
                                (value) => (layoutProps.unsavedChanges = value),
                                { immediate: true },
                            )
                            return {
                                current: computed(
                                    () => query.section ?? 'access',
                                ),
                            }
                        },
                        template:
                            '<div><slot :active-section="current" /></div>',
                    },
                    PlatformMailSettings: editorStub(
                        'PlatformMailSettings',
                        mailDirty,
                    ),
                    PlatformBlocklistSettings: editorStub(
                        'PlatformBlocklistSettings',
                    ),
                    PlatformOAuthSettings: true,
                    PlatformSettingsStatus: true,
                    LayoutPageHeader: true,
                    UForm: formStub,
                    LayoutPanel: true,
                },
            },
        },
    )
    await flushPromises()
    return wrapper
}

describe('platform settings page', () => {
    beforeEach(() => {
        for (const key of Object.keys(query)) delete query[key]
        mailDirty.value = false
        selectSection.mockReset()
        vi.mocked(updateSettings).mockReset()
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('definePageMeta', () => {})
        vi.stubGlobal('useHead', () => {})
        vi.stubGlobal('useRoute', () => ({ query }))
        vi.stubGlobal('useSectionQuery', () => ({ select: selectSection }))
        vi.stubGlobal('useSettingsRecord', async () => ({
            data: settings,
            error: ref(null),
            refresh: vi.fn(),
        }))
        vi.stubGlobal('legalFieldsFrom', legalFieldsFrom)
        vi.stubGlobal('legalPayload', legalPayload)
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
    })

    it('keeps the mail draft across section switches and guards leaving', async () => {
        query.section = 'mail'
        const wrapper = await mountPage()
        mailDirty.value = true
        await flushPromises()

        query.section = 'blocklists'
        await flushPromises()

        const mail = wrapper.findComponent({ name: 'PlatformMailSettings' })
        expect(mail.exists()).toBe(true)
        expect((mail.element as HTMLElement).style.display).toBe('none')
        expect(layoutProps.unsavedChanges).toBe(true)
    })

    it('saves only the changed fields once', async () => {
        let finish!: (value: unknown) => void
        vi.mocked(updateSettings).mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve)),
        )
        const wrapper = await mountPage()
        const vm = wrapper.findComponent(SettingsPage).vm as unknown as {
            form: { audit_retention_days: number }
        }
        vm.form.audit_retention_days = 30
        const form = wrapper.findComponent({ name: 'UForm' })

        form.vm.$emit('submit')
        form.vm.$emit('submit')
        finish({ ...settings.value, audit_retention_days: 30 })
        await flushPromises()

        expect(updateSettings).toHaveBeenCalledTimes(1)
        expect(updateSettings).toHaveBeenCalledWith({
            audit_retention_days: 30,
        })
    })

    it('opens the section of a failing field', async () => {
        const wrapper = await mountPage()

        wrapper.findComponent({ name: 'UForm' }).vm.$emit('error', {
            errors: [{ name: 'privacy_doc', message: 'bad' }],
        })

        expect(selectSection).toHaveBeenCalledWith('privacy')
    })
})
