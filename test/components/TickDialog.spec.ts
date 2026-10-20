import { flushPromises, mount } from '@vue/test-utils'
import { reactive, ref, watch } from 'vue'
import TickDialog from '~/components/tick/Dialog.vue'
import { ApiError } from '~/api/client'
import { dialogShellStub } from '../__stubs__/dialogShell'

const createTick = vi.fn()
const notify = vi.fn()
const notifyError = vi.fn()
const setErrors = vi.fn()

const stubs = {
    LayoutDialogShell: dialogShellStub,
    UForm: {
        setup(_: unknown, { expose }: { expose: (api: object) => void }) {
            expose({ validate: async () => true, setErrors })
        },
        template: '<form><slot /></form>',
    },
    UButton: {
        emits: ['click'],
        template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
    },
    UTextarea: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UFormField: { template: '<div><slot /></div>' },
    UInputNumber: true,
    UInput: true,
}

function mountDialog() {
    return mount(TickDialog, {
        props: { modelValue: false, routeId: 'r1' },
        global: { stubs, mocks: { $t: (key: string) => key } },
    })
}

describe('TickDialog', () => {
    beforeEach(() => {
        createTick.mockReset()
        notify.mockReset()
        notifyError.mockReset()
        setErrors.mockReset()
        vi.stubGlobal('reactive', reactive)
        vi.stubGlobal('watch', watch)
        vi.stubGlobal('useTemplateRef', (key: string) => {
            const target = ref()
            templateRefs.set(key, target)
            return target
        })
        vi.stubGlobal('useAuthStore', () => ({ record: { id: 'u1' } }))
        vi.stubGlobal('useTickOutbox', () => ({
            createTick,
            updateTick: vi.fn(),
        }))
        vi.stubGlobal('useNotification', () => ({
            notify,
            error: notifyError,
        }))
    })

    const templateRefs = new Map<string, { value: unknown }>()

    it('keeps the note after a failed save and saves exactly once per click', async () => {
        let fail!: (error: unknown) => void
        createTick.mockImplementationOnce(
            () => new Promise((_, reject) => (fail = reject)),
        )
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        await wrapper.get('textarea').setValue('Heel hook')
        const submit = wrapper.get('[data-testid="tick-submit"]')

        await submit.trigger('click')
        await submit.trigger('click')
        await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
        fail(Object.assign(new Error('boom'), { status: 500 }))
        await flushPromises()

        expect(createTick).toHaveBeenCalledTimes(1)
        expect(notifyError).toHaveBeenCalledWith('ticks.saveError')
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
        expect(
            (wrapper.get('textarea').element as HTMLTextAreaElement).value,
        ).toBe('Heel hook')

        createTick.mockResolvedValueOnce({ tick: { id: 't1' }, queued: false })
        await submit.trigger('click')
        await flushPromises()
        expect(createTick).toHaveBeenCalledTimes(2)
        expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    })

    it('shows server field errors on the form', async () => {
        createTick.mockRejectedValueOnce({
            status: 400,
            response: { data: { note: { code: 'validation_required' } } },
        })
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        await wrapper.get('[data-testid="tick-submit"]').trigger('click')
        await flushPromises()

        expect(setErrors).toHaveBeenCalledWith([
            { name: 'note', message: 'validation.required' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('asks to sign in again instead of a generic error when the session ended', async () => {
        createTick.mockRejectedValueOnce(
            Object.assign(Object.create(ApiError.prototype), {
                status: 401,
                sessionEnded: true,
            }),
        )
        const wrapper = mountDialog()
        await wrapper.setProps({ modelValue: true })
        await wrapper.get('textarea').setValue('Kept')
        await wrapper.get('[data-testid="tick-submit"]').trigger('click')
        await flushPromises()

        expect(notifyError).not.toHaveBeenCalled()
        expect(notify).toHaveBeenCalledWith(
            'errors.sessionEnded',
            'warning',
            expect.objectContaining({ label: 'routes.login' }),
            'session-ended',
        )
        expect(
            (wrapper.get('textarea').element as HTMLTextAreaElement).value,
        ).toBe('Kept')
    })
})
