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
})
