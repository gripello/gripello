import { flushPromises, mount } from '@vue/test-utils'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import RouteFormDialog from '~/components/route/FormDialog.vue'
import {
    archiveRoute,
    createRoute,
    deleteRoute,
    listRouteColors,
    listRoutes,
    updateRoute,
} from '~/api/routes'
import type { RouteRecord } from '~/types/models'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/routes', () => ({
    archiveRoute: vi.fn(),
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

const confirmDialogStub = {
    name: 'ConfirmDialog',
    props: ['modelValue', 'title', 'message', 'confirmText', 'loading'],
    emits: ['update:modelValue', 'confirm'],
    template: `<div v-if="modelValue" data-testid="confirm-dialog">
        <slot />
        <button data-testid="confirm-dialog-confirm" @click="$emit('confirm')">{{ confirmText }}</button>
    </div>`,
}

function mountDialog() {
    return mount(RouteFormDialog, {
        global: {
            mocks: {
                $t: (key: string, params?: { name?: string }) =>
                    params?.name ? `${key}(${params.name})` : key,
            },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                ConfirmDialog: confirmDialogStub,
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
                ColorSwatchPicker: {
                    name: 'ColorSwatchPicker',
                    props: ['swatches'],
                    template: '<div data-testid="route-form-color" />',
                },
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

async function openEditAgain(wrapper: ReturnType<typeof mountDialog>) {
    await (
        wrapper.vm as unknown as { open: (route: RouteRecord) => Promise<void> }
    ).open(route)
    await flushPromises()
}

describe('RouteFormDialog', () => {
    beforeEach(() => {
        vi.mocked(updateRoute).mockReset()
        vi.mocked(createRoute).mockReset()
        vi.mocked(deleteRoute).mockReset()
        vi.mocked(archiveRoute).mockReset()
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

    it('asks before discarding once the form was edited', async () => {
        const wrapper = await openEdit()
        const shell = wrapper.findComponent(dialogShellStub)
        expect(shell.props('dirty')).toBe(false)
        await wrapper.get('[data-testid="route-form-name"]').setValue('New')
        expect(shell.props('dirty')).toBe(true)
    })

    it('keeps the colour swatches in the same order on every open', async () => {
        const colors = ['#000000', '#2196F3', '#F44336', '#FFEB3B']
        vi.mocked(listRouteColors).mockResolvedValue(colors)
        const wrapper = await openEdit()
        const picker = () =>
            wrapper.findComponent({ name: 'ColorSwatchPicker' })
        expect(picker().props('swatches')).toEqual(colors)
        await openEditAgain(wrapper)
        expect(picker().props('swatches')).toEqual(colors)
    })

    it('puts the colour right after the grade', async () => {
        const wrapper = await openEdit()
        const html = wrapper.html()
        const grade = html.indexOf('route-form-difficulty')
        const color = html.indexOf('route-form-color')
        expect(grade).toBeGreaterThan(-1)
        expect(color).toBeGreaterThan(grade)
        expect(html.slice(grade, color)).not.toContain('route-form-location')
    })

    it('limits the comment to what the API accepts', async () => {
        const wrapper = await openEdit()
        const comment = wrapper.get('[data-testid="route-form-comment"]')
        expect(comment.attributes('maxlength')).toBe('255')
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

    it('names the route when asking to delete it', async () => {
        vi.mocked(deleteRoute).mockResolvedValue(undefined as never)
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-delete"]').trigger('click')
        const confirm = wrapper.getComponent(confirmDialogStub)
        expect(confirm.props('title')).toBe(
            'notifications.deleteRouteTitle(Crimpy)',
        )
        expect(confirm.props('message')).toBe('notifications.deleteRoute')
        expect(confirm.props('confirmText')).toBeUndefined()
        expect(
            wrapper.find('[data-testid="route-delete-archive"]').exists(),
        ).toBe(false)

        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(deleteRoute).toHaveBeenCalledWith('r1', false)
        expect(wrapper.emitted('deleted')?.[0]).toEqual(['r1'])
    })

    it('offers archiving once the server refuses because of history', async () => {
        vi.mocked(deleteRoute).mockRejectedValueOnce(
            Object.assign(new Error('conflict'), { status: 409 }),
        )
        vi.mocked(archiveRoute).mockResolvedValue({ id: 'r1' } as never)
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-delete"]').trigger('click')
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()

        const confirm = wrapper.getComponent(confirmDialogStub)
        expect(confirm.props('title')).toBe(
            'notifications.deleteRouteWithHistoryTitle(Crimpy)',
        )
        expect(confirm.props('message')).toBe(
            'notifications.deleteRouteWithHistory',
        )
        expect(confirm.props('confirmText')).toBe(
            'notifications.deleteEverything',
        )
        expect(wrapper.emitted('deleted')).toBeUndefined()

        await wrapper
            .get('[data-testid="route-delete-archive"]')
            .trigger('click')
        await flushPromises()
        expect(archiveRoute).toHaveBeenCalledWith('r1')
        expect(deleteRoute).toHaveBeenCalledTimes(1)
        expect(wrapper.emitted('archived')).toEqual([['r1']])
        expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(
            false,
        )
        expect(wrapper.getComponent(dialogShellStub).props('modelValue')).toBe(
            false,
        )
    })

    it('force-deletes on the second confirm after a refusal', async () => {
        vi.mocked(deleteRoute)
            .mockRejectedValueOnce(
                Object.assign(new Error('conflict'), { status: 409 }),
            )
            .mockResolvedValueOnce(undefined as never)
        const wrapper = await openEdit()
        await wrapper.get('[data-testid="route-form-delete"]').trigger('click')
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        await wrapper
            .get('[data-testid="confirm-dialog-confirm"]')
            .trigger('click')
        await flushPromises()
        expect(deleteRoute).toHaveBeenLastCalledWith('r1', true)
        expect(archiveRoute).not.toHaveBeenCalled()
        expect(wrapper.emitted('deleted')?.[0]).toEqual(['r1'])
    })
})
