import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import SegmentedControl from '~/components/SegmentedControl.vue'

const tabsStub = defineComponent({
    props: ['modelValue', 'items', 'content', 'variant', 'size', 'ui'],
    emits: ['update:modelValue'],
    setup(props, { slots, emit, attrs }) {
        return () =>
            h(
                'div',
                {
                    'data-testid': attrs['data-testid'],
                    'data-size': props.size,
                    'data-trigger': props.ui?.trigger,
                },
                props.items.map((item: { value: string }) =>
                    h(
                        'button',
                        {
                            'aria-selected': props.modelValue === item.value,
                            onClick: () =>
                                emit('update:modelValue', item.value),
                        },
                        slots.default?.({ item }),
                    ),
                ),
            )
    },
})

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(SegmentedControl, {
        props: {
            modelValue: 'boulder',
            items: [
                { value: 'boulder', label: 'Boulders' },
                { value: 'route', label: 'Routes' },
            ],
            testId: 'kind',
            ...props,
        },
        global: { stubs: { UTabs: tabsStub } },
    })
}

describe('SegmentedControl', () => {
    it('renders every option with a per-option test id', () => {
        const wrapper = createWrapper()

        expect(
            wrapper.get('[data-testid="kind"]').attributes('data-size'),
        ).toBe('sm')
        expect(wrapper.get('[data-testid="kind-boulder"]').text()).toBe(
            'Boulders',
        )
        expect(wrapper.get('[data-testid="kind-route"]').text()).toBe('Routes')
    })

    it('emits the picked value', async () => {
        const wrapper = createWrapper()

        await wrapper.get('[data-testid="kind-route"]').trigger('click')

        expect(wrapper.emitted('update:modelValue')).toEqual([['route']])
    })

    it('lets an option carry its own test id', () => {
        const wrapper = createWrapper({
            items: [
                { value: 'boulder', label: 'Boulders', testId: 'tool-boulder' },
                { value: 'route', label: 'Routes' },
            ],
        })

        expect(wrapper.find('[data-testid="tool-boulder"]').exists()).toBe(true)
        expect(wrapper.find('[data-testid="kind-route"]').exists()).toBe(true)
    })

    it('stretches its options across the full width as a block', () => {
        const wrapper = createWrapper({ block: true })

        const tabs = wrapper.get('[data-testid="kind"]')
        expect(tabs.attributes('data-trigger')).toBe('flex-1')
        expect(tabs.classes()).toContain('w-full')
    })
})
