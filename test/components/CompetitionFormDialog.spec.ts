import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import CompetitionFormDialog from '~/components/competition/FormDialog.vue'
import {
    createCompetition,
    createCompetitionCategory,
    updateCompetition,
} from '~/api/competitions'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/competitions', () => ({
    createCompetition: vi.fn(),
    createCompetitionCategory: vi.fn(),
    updateCompetition: vi.fn(),
}))

const setErrors = vi.fn()
const notifyError = vi.fn()

function mountDialog() {
    return mount(CompetitionFormDialog, {
        props: { modelValue: false },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                UForm: {
                    setup(
                        _: unknown,
                        { expose }: { expose: (api: object) => void },
                    ) {
                        expose({ validate: async () => true, setErrors })
                    },
                    template: '<form />',
                },
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
                },
            },
        },
    })
}

describe('CompetitionFormDialog', () => {
    beforeEach(() => {
        vi.mocked(createCompetition).mockReset()
        vi.mocked(createCompetitionCategory).mockReset()
        vi.mocked(updateCompetition).mockReset()
        setErrors.mockReset()
        notifyError.mockReset()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
        vi.stubGlobal('useLocations', () => ({
            data: ref([{ id: 'l1', name: 'Hall' }]),
            items: ref([{ value: 'l1', label: 'Hall' }]),
        }))
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: notifyError,
            notify: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
    })

    it('finishes the draft it already created when a retry follows a failure', async () => {
        vi.mocked(createCompetition).mockResolvedValue({ id: 'c1' } as never)
        vi.mocked(updateCompetition).mockResolvedValue({ id: 'c1' } as never)
        vi.mocked(createCompetitionCategory)
            .mockResolvedValueOnce({} as never)
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue({} as never)
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        const save = wrapper.get('[data-testid="competition-form-save"]')

        await save.trigger('click')
        await save.trigger('click')
        await flushPromises()
        expect(notifyError).toHaveBeenCalledTimes(1)
        expect(wrapper.emitted('saved')).toBeUndefined()

        await save.trigger('click')
        await flushPromises()

        expect(createCompetition).toHaveBeenCalledTimes(1)
        expect(updateCompetition).toHaveBeenCalledTimes(1)
        const categoryNames = vi
            .mocked(createCompetitionCategory)
            .mock.calls.filter((_, index) => index !== 1)
            .map(([, category]) => category.name)
        expect(new Set(categoryNames).size).toBe(categoryNames.length)
        expect(wrapper.emitted('saved')).toEqual([[{ id: 'c1' }]])
    })

    it('shows server field errors on the matching fields', async () => {
        vi.mocked(createCompetition).mockRejectedValue({
            status: 400,
            response: {
                data: { ends_at: { code: 'validation_invalid_date' } },
            },
        })
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        await wrapper
            .get('[data-testid="competition-form-save"]')
            .trigger('click')
        await flushPromises()

        expect(setErrors).toHaveBeenCalledWith([
            { name: 'endsAt', message: 'validation.invalid' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('keeps the half-created draft across close and reopen until it saved', async () => {
        vi.mocked(createCompetition).mockResolvedValue({ id: 'c1' } as never)
        vi.mocked(updateCompetition).mockResolvedValue({ id: 'c1' } as never)
        vi.mocked(createCompetitionCategory)
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue({} as never)
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        await wrapper
            .get('[data-testid="competition-form-save"]')
            .trigger('click')
        await flushPromises()
        expect(wrapper.emitted('saved')).toBeUndefined()

        await wrapper.setProps({ modelValue: false })
        await wrapper.setProps({ modelValue: true })
        await wrapper
            .get('[data-testid="competition-form-save"]')
            .trigger('click')
        await flushPromises()
        expect(createCompetition).toHaveBeenCalledTimes(1)
        expect(updateCompetition).toHaveBeenCalledWith('c1', expect.anything())
        expect(wrapper.emitted('saved')).toEqual([[{ id: 'c1' }]])

        await wrapper.setProps({ modelValue: false })
        await wrapper.setProps({ modelValue: true })
        await wrapper
            .get('[data-testid="competition-form-save"]')
            .trigger('click')
        await flushPromises()
        expect(createCompetition).toHaveBeenCalledTimes(2)
    })
})
