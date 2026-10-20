import { mount } from '@vue/test-utils'
import { computed, ref, useTemplateRef } from 'vue'
import OptionGrid from '~/components/option/Grid.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('useTemplateRef', useTemplateRef)

const UButton = {
    inheritAttrs: false,
    props: ['color', 'variant', 'icon', 'disabled'],
    emits: ['click', 'keydown'],
    template:
        '<button v-bind="$attrs" :data-color="color" :data-variant="variant" :disabled="disabled" @click="$emit(\'click\')" @keydown="$emit(\'keydown\', $event)"><slot /></button>',
}

const items = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B', id: 'bee', color: 'error' as const },
]

function mountGrid(props: Record<string, unknown> = {}) {
    const model = ref((props.modelValue as string | null) ?? null)
    const wrapper = mount(OptionGrid, {
        props: {
            items,
            modelValue: model.value,
            'onUpdate:modelValue': (value: string | null) => {
                model.value = value
                wrapper.setProps({ modelValue: value })
            },
            testIdPrefix: 'opt',
            label: 'Pick one',
            ...props,
        },
        global: { stubs: { UButton } },
        attachTo: document.body,
    })
    return { wrapper, model }
}

describe('OptionGrid', () => {
    it('is a radiogroup that marks the picked option checked', async () => {
        const { wrapper, model } = mountGrid()
        expect(wrapper.attributes('role')).toBe('radiogroup')
        expect(wrapper.attributes('aria-label')).toBe('Pick one')
        await wrapper.find('[data-testid="opt-bee"]').trigger('click')
        expect(model.value).toBe('b')
        const picked = wrapper.find('[data-testid="opt-bee"]')
        expect(picked.attributes('aria-checked')).toBe('true')
        expect(picked.attributes('data-color')).toBe('error')
        expect(picked.attributes('data-variant')).toBe('soft')
        expect(picked.attributes('tabindex')).toBe('0')
        expect(
            wrapper.find('[data-testid="opt-a"]').attributes('aria-checked'),
        ).toBe('false')
    })

    it('clears the pick only when deselectable', async () => {
        const fixed = mountGrid({ modelValue: 'a' })
        await fixed.wrapper.find('[data-testid="opt-a"]').trigger('click')
        expect(fixed.model.value).toBe('a')

        const loose = mountGrid({ modelValue: 'a', deselectable: true })
        await loose.wrapper.find('[data-testid="opt-a"]').trigger('click')
        expect(loose.model.value).toBeNull()
    })

    it('moves the pick with arrow keys and wraps around', async () => {
        const { wrapper, model } = mountGrid({ modelValue: 'a' })
        await wrapper.find('[data-testid="opt-a"]').trigger('keydown', {
            key: 'ArrowLeft',
        })
        expect(model.value).toBe('b')
        expect(document.activeElement).toBe(
            wrapper.find('[data-testid="opt-bee"]').element,
        )
        wrapper.unmount()
    })

    it('focuses the radio in DOM order after the items were reordered', async () => {
        const { wrapper, model } = mountGrid({ modelValue: 'a' })
        await wrapper.setProps({ items: [...items].reverse() })
        await wrapper.find('[data-testid="opt-bee"]').trigger('keydown', {
            key: 'ArrowRight',
        })
        expect(model.value).toBe('a')
        expect(document.activeElement).toBe(
            wrapper.find('[data-testid="opt-a"]').element,
        )
        wrapper.unmount()
    })
})
