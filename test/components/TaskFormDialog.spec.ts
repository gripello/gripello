import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import TaskFormDialog from '~/components/task/FormDialog.vue'
import { createTask, updateTask } from '~/api/tasks'
import { listWalls } from '~/api/routes'
import { useAsyncAction } from '~/composables/useAsyncAction'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/tasks', () => ({
    createTask: vi.fn(),
    updateTask: vi.fn(),
    listTaskAssignees: vi.fn(async () => []),
}))
vi.mock('~/api/routes', () => ({ listWalls: vi.fn(async () => []) }))

const setErrors = vi.fn()
const notifyError = vi.fn()

function mountDialog(props: Record<string, unknown> = {}) {
    return mount(TaskFormDialog, {
        props: { modelValue: false, ...props },
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
                UIcon: true,
            },
        },
    })
}

describe('TaskFormDialog', () => {
    beforeEach(() => {
        vi.mocked(createTask).mockReset()
        setErrors.mockReset()
        notifyError.mockReset()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('useI18n', () => ({
            t: (key: string) => key,
            locale: ref('en'),
        }))
        vi.stubGlobal('useAuthStore', () => ({ record: { id: 'u1' } }))
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
        vi.stubGlobal('useGymPath', () => (path: string) => path)
        vi.stubGlobal('useFileToken', () => ({
            token: ref(''),
            renew: vi.fn(),
        }))
        vi.stubGlobal('useLocations', () => ({
            data: ref([{ id: 'l1', name: 'Hall' }]),
            items: ref([{ value: 'l1', label: 'Hall' }]),
        }))
        vi.stubGlobal('useNotification', () => ({
            success: vi.fn(),
            error: notifyError,
            warning: vi.fn(),
            notify: vi.fn(),
        }))
        vi.stubGlobal('useAsyncAction', useAsyncAction)
    })

    it('maps server field errors onto the form and stays open', async () => {
        let fail!: (error: unknown) => void
        vi.mocked(createTask).mockImplementationOnce(
            () => new Promise((_, reject) => (fail = reject)),
        )
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        const save = wrapper.get('[data-testid="task-form-save"]')

        await save.trigger('click')
        await save.trigger('click')
        await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
        fail({
            status: 400,
            response: {
                data: {
                    title: { code: 'validation_required' },
                    due_date: { code: 'validation_invalid_date' },
                },
            },
        })
        await flushPromises()

        expect(createTask).toHaveBeenCalledTimes(1)
        expect(setErrors).toHaveBeenCalledWith([
            { name: 'title', message: 'validation.required' },
            { name: 'dueDate', message: 'validation.invalid' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })

    it('keeps the wall of an existing task while the walls are loading', async () => {
        let resolveWalls!: (walls: unknown[]) => void
        vi.mocked(listWalls).mockImplementationOnce(
            () => new Promise((resolve) => (resolveWalls = resolve)) as never,
        )
        vi.mocked(updateTask).mockResolvedValueOnce({ id: 't1' } as never)
        const wrapper = mountDialog({
            task: {
                id: 't1',
                kind: 'maintenance',
                title: 'Fix',
                priority: 2,
                status: 'open',
                location: 'l2',
                wall: 'w1',
                created: '2026-01-01T00:00:00.000Z',
            },
        })
        await wrapper.setProps({ modelValue: true })
        await flushPromises()
        resolveWalls([{ id: 'w1', name: 'Wall', location: 'l2' }])
        await flushPromises()

        await wrapper.get('[data-testid="task-form-save"]').trigger('click')
        await flushPromises()

        expect(vi.mocked(updateTask).mock.calls[0]![1]).not.toHaveProperty(
            'wall',
        )
    })

    it('sends only changed fields so a status set elsewhere survives the save', async () => {
        vi.mocked(updateTask).mockReset()
        vi.mocked(updateTask).mockResolvedValueOnce({ id: 't1' } as never)
        const wrapper = mountDialog({
            task: {
                id: 't1',
                kind: 'maintenance',
                title: 'Fix',
                priority: 2,
                status: 'open',
                location: 'l1',
                created: '2026-01-01T00:00:00.000Z',
            },
        })
        await wrapper.setProps({ modelValue: true })
        await flushPromises()

        await wrapper.get('[data-testid="task-form-save"]').trigger('click')
        await flushPromises()

        expect(updateTask).toHaveBeenCalledWith('t1', {}, null)
    })
})
