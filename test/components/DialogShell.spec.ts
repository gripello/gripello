import { mount } from '@vue/test-utils'
import {
    computed,
    defineComponent,
    h,
    nextTick,
    ref,
    resolveComponent,
    watch,
} from 'vue'
import DialogShell from '~/components/layout/DialogShell.vue'
import { listenBeforeRouter } from '~/utils/dialogHistory'

listenBeforeRouter()

const width = ref(1440)

const overlayStub = (name: string) =>
    defineComponent({
        name,
        props: ['open', 'content', 'noBodyStyles'],
        setup(props, { slots }) {
            return () =>
                h(
                    'div',
                    {
                        'data-overlay': name,
                        'data-no-body-styles': props.noBodyStyles,
                        'data-blocks-outside':
                            props.content?.disableOutsidePointerEvents,
                        style: props.content?.style,
                    },
                    props.open ? slots.content?.() : [],
                )
        },
    })

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(DialogShell, {
        props: { modelValue: false, sheetOnMobile: true, ...props },
        global: {
            mocks: { $t: (key: string) => key },
            components: {
                UModal: overlayStub('UModal'),
                UDrawer: overlayStub('UDrawer'),
            },
            stubs: { UButton: true },
        },
    })
}

beforeEach(() => {
    width.value = 1440
    vi.stubGlobal('resolveComponent', resolveComponent)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useDisplay', () => ({
        smAndUp: computed(() => width.value >= 600),
    }))
})

describe('DialogShell', () => {
    it('turns a numeric max width string into pixels', async () => {
        const wrapper = createWrapper({ maxWidth: '600' })
        await wrapper.setProps({ modelValue: true })
        expect(
            wrapper.find('[data-overlay="UModal"]').attributes('style'),
        ).toContain('--dialog-width: 600px')
    })

    it('keeps css max widths as they are', async () => {
        const wrapper = createWrapper({ maxWidth: '80vw' })
        await wrapper.setProps({ modelValue: true })
        expect(
            wrapper.find('[data-overlay="UModal"]').attributes('style'),
        ).toContain('--dialog-width: 80vw')
    })

    it('opens as a modal when the real width arrives right before opening', async () => {
        width.value = 0
        const wrapper = createWrapper()
        width.value = 1440
        await wrapper.setProps({ modelValue: true })
        await nextTick()
        expect(wrapper.find('[data-overlay="UModal"]').exists()).toBe(true)
        expect(wrapper.find('[data-overlay="UDrawer"]').exists()).toBe(false)
    })

    it('opens as a bottom sheet on phones', async () => {
        width.value = 390
        const wrapper = createWrapper()
        await wrapper.setProps({ modelValue: true })
        expect(wrapper.find('[data-overlay="UDrawer"]').exists()).toBe(true)
    })

    it('leaves body scroll locking of sheets to the dialog, not vaul', async () => {
        width.value = 390
        const wrapper = createWrapper()
        await wrapper.setProps({ modelValue: true })
        expect(
            wrapper
                .find('[data-overlay="UDrawer"]')
                .attributes('data-no-body-styles'),
        ).toBe('true')
        wrapper.unmount()
    })

    it('keeps sheets tappable while the dialog locks the body', async () => {
        width.value = 390
        const wrapper = createWrapper()
        await wrapper.setProps({ modelValue: true })
        expect(
            wrapper
                .find('[data-overlay="UDrawer"]')
                .attributes('data-blocks-outside'),
        ).toBe('true')
        wrapper.unmount()
    })

    it('puts header actions between the title and the close button', async () => {
        const wrapper = mount(DialogShell, {
            props: { modelValue: true, title: 'T', closable: true },
            slots: { 'header-actions': '<a data-testid="extra">pdf</a>' },
            global: {
                mocks: { $t: (key: string) => key },
                components: {
                    UModal: overlayStub('UModal'),
                    UDrawer: overlayStub('UDrawer'),
                },
                stubs: {
                    UButton: {
                        template: '<button data-testid="dialog-close" />',
                    },
                },
            },
        })
        await nextTick()
        const title = wrapper.find('.dialog-shell__title')
        const order = title
            .findAll('[data-testid]')
            .map((el) => el.attributes('data-testid'))
        expect(order).toEqual(['extra', 'dialog-close'])
    })

    it('moves focus into a sheet once it has opened', async () => {
        width.value = 390
        const wrapper = mount(DialogShell, {
            props: { modelValue: false, sheetOnMobile: true },
            attachTo: document.body,
            global: {
                mocks: { $t: (key: string) => key },
                components: {
                    UModal: overlayStub('UModal'),
                    UDrawer: overlayStub('UDrawer'),
                },
                stubs: { UButton: true },
            },
        })
        await wrapper.setProps({ modelValue: true })
        wrapper.findComponent({ name: 'UDrawer' }).vm.$emit('after:enter')
        expect(document.activeElement).toBe(
            wrapper.find('.dialog-shell').element,
        )
        wrapper.unmount()
    })

    it('closes on the back gesture instead of leaving the page', async () => {
        const wrapper = createWrapper()
        await wrapper.setProps({ modelValue: true })
        expect(history.state.dialogShell).toBeTypeOf('number')

        window.dispatchEvent(new PopStateEvent('popstate', { state: null }))

        expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
        wrapper.unmount()
    })

    it('keeps persistent dialogs out of the history', async () => {
        const before = history.length
        const wrapper = createWrapper({ persistent: true })
        await wrapper.setProps({ modelValue: true })
        expect(history.length).toBe(before)
        wrapper.unmount()
    })

    describe('footer', () => {
        const buttonStub = {
            props: ['disabled', 'loading'],
            emits: ['click'],
            template:
                '<button :disabled="disabled" :data-loading="loading" @click="$emit(\'click\')"><slot /></button>',
        }
        const mountFooter = (
            props: Record<string, unknown> = {},
            slots: Record<string, string> = {},
        ) =>
            mount(DialogShell, {
                props: {
                    modelValue: true,
                    submitLabel: 'Save',
                    submitTestId: 'save',
                    cancelTestId: 'cancel',
                    ...props,
                },
                slots,
                global: {
                    mocks: { $t: (key: string) => key },
                    components: {
                        UModal: overlayStub('UModal'),
                        UDrawer: overlayStub('UDrawer'),
                    },
                    stubs: {
                        UButton: buttonStub,
                        CaptchaLoader: { template: '<i data-testid="cap" />' },
                    },
                },
            })

        it('submits and closes on cancel', async () => {
            const wrapper = mountFooter()
            await wrapper.get('[data-testid="save"]').trigger('click')
            expect(wrapper.emitted('submit')).toHaveLength(1)
            await wrapper.get('[data-testid="cancel"]').trigger('click')
            expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
            wrapper.unmount()
        })

        it('leaves cancel to a listener when there is one', async () => {
            const onCancel = vi.fn()
            const wrapper = mountFooter({ onCancel })
            await wrapper.get('[data-testid="cancel"]').trigger('click')
            expect(onCancel).toHaveBeenCalled()
            expect(wrapper.emitted('update:modelValue')).toBeUndefined()
            wrapper.unmount()
        })

        it('shows the captcha progress instead of the label while solving', () => {
            const wrapper = mountFooter({ captcha: true, submitLoading: true })
            const submit = wrapper.get('[data-testid="save"]')
            expect(submit.find('[data-testid="cap"]').exists()).toBe(true)
            expect(submit.attributes('disabled')).toBeDefined()
            wrapper.unmount()
        })

        it('puts extra buttons after cancel and keeps the actions override', () => {
            const extra = mountFooter(
                {},
                { 'footer-start': '<a data-testid="delete" />' },
            )
            const order = extra
                .findAll('[data-testid]')
                .map((el) => el.attributes('data-testid'))
            expect(order.slice(-3)).toEqual(['cancel', 'delete', 'save'])
            extra.unmount()

            const custom = mountFooter(
                {},
                { actions: '<a data-testid="own" />' },
            )
            expect(custom.find('[data-testid="save"]').exists()).toBe(false)
            expect(custom.find('[data-testid="own"]').exists()).toBe(true)
            custom.unmount()
        })
    })
})
