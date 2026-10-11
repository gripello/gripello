import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import WishDialog from '~/components/task/WishDialog.vue'

const create = vi.fn()
vi.mock('~/api/tasks', () => ({
    createTask: (...args: unknown[]) => create(...args),
}))
const slotStub = { template: '<div><slot /><slot name="actions" /></div>' }
const buttonStub = {
    props: ['disabled'],
    template:
        '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

function mountDialog(props: Record<string, unknown>) {
    return mount(WishDialog, {
        props: { modelValue: false, ...props },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: slotStub,
                UFormField: slotStub,
                UButton: buttonStub,
                USelect: true,
                UTextarea: true,
                CaptchaLoader: true,
            },
        },
    })
}

describe('TaskWishDialog', () => {
    beforeEach(() => {
        create.mockReset()
        vi.stubGlobal('useCapToken', () => ({
            capHeaders: async () => ({ 'X-Cap-Token': 'token' }),
        }))
        vi.stubGlobal('useAsyncAction', () => ({
            pending: ref(false),
            run: async (action: () => Promise<unknown>) => action(),
        }))
        vi.stubGlobal('useLocations', () => ({
            data: ref([{ id: 'hall', name: 'Hall' }]),
        }))
        vi.stubGlobal('useGradeSystems', () => ({
            gradeSystemFor: () => 'font',
        }))
        vi.stubGlobal('computed', computed)
        vi.stubGlobal('useCurrentGymId', () => ref('g1'))
    })

    it('sends a wish prefilled from the current filters', async () => {
        const wrapper = mountDialog({
            locationId: 'hall',
            wallId: 'north',
            routeType: 'Boulder',
            grade: '6A',
        })
        await wrapper.setProps({ modelValue: true })
        await flushPromises()

        await wrapper.find('[data-testid="task-wish-submit"]').trigger('click')
        await flushPromises()

        expect(create).toHaveBeenCalledWith(
            'g1',
            {
                kind: 'wish',
                location: 'hall',
                wall: 'north',
                route_type: 'Boulder',
                grade: '6A',
                description: '',
            },
            null,
            { headers: { 'X-Cap-Token': 'token' } },
        )
    })

    it('needs a route type before it can be sent', async () => {
        const wrapper = mountDialog({ locationId: 'hall' })
        await wrapper.setProps({ modelValue: true })
        await flushPromises()

        expect(
            wrapper.find('[data-testid="task-wish-submit"]').attributes(),
        ).toHaveProperty('disabled')
    })
})
