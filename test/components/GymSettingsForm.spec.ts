import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import GymSettingsForm from '~/components/admin/GymSettingsForm.vue'
import { updateGym } from '~/api/gyms'
import { useAsyncAction } from '~/composables/useAsyncAction'
import type { GymRecord } from '~/types/models'

vi.mock('~/api/gyms', () => ({ updateGym: vi.fn() }))

const selectSection = vi.fn()
const setErrors = vi.fn()
const notifyError = vi.fn()
const query = reactive<Record<string, string>>({})
const shownSection = ref('organization')

const gym = {
    id: 'g1',
    slug: 'hall',
    name: 'Hall',
    page_logo: 'logo.png',
} as unknown as GymRecord

const formStub = {
    name: 'UForm',
    emits: ['submit', 'error'],
    setup(_: unknown, { expose }: { expose: (api: object) => void }) {
        expose({ submit: vi.fn(), setErrors })
    },
    template: '<form><slot /></form>',
}

function mountForm() {
    return mount(GymSettingsForm, {
        props: { gym, editSlug: true },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                SettingsLayout: {
                    setup: () => ({ shownSection }),
                    template:
                        '<div><slot :active-section="shownSection" /></div>',
                },
                UForm: formStub,
                AdminSettingsBrandingSection: {
                    name: 'AdminSettingsBrandingSection',
                    props: ['assets'],
                    template: '<div />',
                },
                AdminSettingsOrganizationSection: true,
                LayoutPanel: true,
            },
        },
    })
}

describe('GymSettingsForm', () => {
    beforeEach(() => {
        selectSection.mockReset()
        setErrors.mockReset()
        notifyError.mockReset()
        vi.mocked(updateGym).mockReset()
        for (const key of Object.keys(query)) delete query[key]
        shownSection.value = 'organization'
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('useRoute', () => ({ query }))
        vi.stubGlobal('useSectionQuery', () => ({ select: selectSection }))
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: notifyError,
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
    })

    it('opens the section of a failing field that is not shown', async () => {
        const wrapper = mountForm()
        const form = wrapper.findComponent({ name: 'UForm' })

        form.vm.$emit('error', {
            errors: [{ name: 'opening_hours', message: 'bad' }],
        })
        expect(selectSection).toHaveBeenCalledWith('info')

        selectSection.mockReset()
        query.section = 'privacy'
        form.vm.$emit('error', {
            errors: [
                { name: 'opening_hours', message: 'bad' },
                { name: 'privacy_doc', message: 'bad' },
            ],
        })
        expect(selectSection).not.toHaveBeenCalled()
    })

    it('keeps a picked logo when the gym changes remotely', async () => {
        shownSection.value = 'branding'
        const wrapper = mountForm()
        const [logo] = wrapper
            .findComponent({ name: 'AdminSettingsBrandingSection' })
            .props('assets') as {
            preview: { value: string | null }
            onSelect: (file: File) => void
        }[]
        logo!.onSelect(new File(['x'], 'new.png', { type: 'image/png' }))
        await flushPromises()
        const picked = logo!.preview.value
        expect(picked).toMatch(/^blob:/)

        await wrapper.setProps({ gym: { ...gym, page_logo: 'remote.png' } })

        expect(logo!.preview.value).toBe(picked)
    })

    it('puts a taken slug on the field and opens its section', async () => {
        vi.mocked(updateGym).mockRejectedValueOnce({
            status: 400,
            response: {
                data: { slug: { code: 'validation_slug_used', message: '' } },
            },
        })
        shownSection.value = 'branding'
        const wrapper = mountForm()
        const [logo] = wrapper
            .findComponent({ name: 'AdminSettingsBrandingSection' })
            .props('assets') as { onSelect: (file: File) => void }[]
        logo!.onSelect(new File(['x'], 'new.png', { type: 'image/png' }))

        wrapper.findComponent({ name: 'UForm' }).vm.$emit('submit')
        await flushPromises()

        expect(setErrors).toHaveBeenCalledWith([
            { name: 'slug', message: 'gymOnboarding.slugTaken' },
        ])
        expect(selectSection).toHaveBeenCalledWith('organization')
        expect(notifyError).not.toHaveBeenCalled()
    })
})
