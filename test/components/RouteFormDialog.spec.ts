import { flushPromises, mount } from '@vue/test-utils'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import RouteFormDialog from '~/components/route/FormDialog.vue'
import { createRoute, listRoutes, updateRoute } from '~/api/routes'
import type { RouteRecord } from '~/types/models'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/routes', () => ({
    createRoute: vi.fn(),
    deleteRoute: vi.fn(),
    listRouteColors: vi.fn(async () => []),
    listRoutes: vi.fn(async () => ({ items: [] })),
    updateRoute: vi.fn(),
}))

const setErrors = vi.fn()
const notifyError = vi.fn()

const route = {
    id: 'r1',
    name: 'Crimpy',
    grade: '6a',
    grade_system: 'french',
    type: 'Route',
    anchor_point: 4,
    location: 'l1',
    comment: '',
    creator: ['Ann'],
    screw_date: '2026-01-01',
    color: '#F44336',
    archived: false,
    permanent: false,
    wall: '',
    wall_position: null,
} as unknown as RouteRecord

function mountDialog() {
    return mount(RouteFormDialog, {
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                ConfirmDialog: true,
                UForm: {
                    setup(
                        _: unknown,
                        { expose }: { expose: (api: object) => void },
                    ) {
                        expose({ validate: async () => true, setErrors })
                    },
                    template: '<form><slot /></form>',
                },
                UFormField: { template: '<div><slot /></div>' },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                ColorSwatchPicker: true,
            },
        },
    })
}

async function openEdit() {
    const wrapper = mountDialog()
    await (
        wrapper.vm as unknown as { open: (route: RouteRecord) => Promise<void> }
    ).open(route)
    await flushPromises()
    return wrapper
}

describe('RouteFormDialog', () => {
    beforeEach(() => {
        vi.mocked(updateRoute).mockReset()
        vi.mocked(createRoute).mockReset()
        vi.mocked(listRoutes).mockResolvedValue({ items: [] } as never)
        setErrors.mockReset()
        notifyError.mockReset()
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('nextTick', nextTick)
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
        vi.stubGlobal('useGradeSystems', () => ({
            gradeSystemFor: () => 'french',
        }))
        vi.stubGlobal('useLocations', () => ({ data: ref([]), items: ref([]) }))
        vi.stubGlobal('useLocationWalls', () => ref([]))
        vi.stubGlobal('useNotification', () => ({ error: notifyError }))
    })

    it('sends only the changed fields of an edit', async () => {
        vi.mocked(updateRoute).mockResolvedValue({ id: 'r1' } as never)
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-name"]').setValue('Slopy')

        await wrapper.get('[data-testid="route-form-submit"]').trigger('click')
        await flushPromises()

        expect(updateRoute).toHaveBeenCalledWith('r1', { name: 'Slopy' })
        expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({
            id: 'r1',
            name: 'Slopy',
        })
    })

    it('puts server field errors on the form and keeps the dialog open', async () => {
        vi.mocked(updateRoute).mockRejectedValue(
            Object.assign(new Error('invalid'), {
                status: 400,
                response: {
                    data: {
                        name: { code: 'validation_required' },
                        color: { code: 'validation_invalid' },
                    },
                },
            }),
        )
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-name"]').setValue('X')

        await wrapper.get('[data-testid="route-form-submit"]').trigger('click')
        await flushPromises()

        expect(setErrors).toHaveBeenCalledWith([
            { name: 'name', message: 'validation.required' },
            { name: 'color', message: 'validation.invalid' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
        expect(wrapper.emitted('saved')).toBeUndefined()
        expect(wrapper.emitted('closed')).toBeUndefined()
        expect(wrapper.getComponent(dialogShellStub).props('modelValue')).toBe(
            true,
        )
    })

    it('ignores a second submit while the first is saving', async () => {
        let finish!: (value: unknown) => void
        vi.mocked(updateRoute).mockImplementation(
            () => new Promise((resolve) => (finish = resolve)),
        )
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-name"]').setValue('Slopy')
        const submit = wrapper.get('[data-testid="route-form-submit"]')

        await submit.trigger('click')
        await submit.trigger('click')
        await flushPromises()
        expect(updateRoute).toHaveBeenCalledTimes(1)

        finish({ id: 'r1' })
        await flushPromises()
        expect(wrapper.emitted('saved')).toHaveLength(1)
    })
})
