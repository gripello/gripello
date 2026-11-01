import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, watch } from 'vue'
import MapEditorHallTab from '~/components/map/EditorHallTab.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { addWall, newFloorPlan, updateWall } from '~/utils/mapEditor'

let nextFile: File | null = null

beforeEach(() => {
    nextFile = null
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
})

function setup(hasTrace = true) {
    const editor = useMapEditor()
    const state = updateWall(
        addWall(
            { map: { ...newFloorPlan(20, 20), shapes: [] }, walls: [] },
            'w',
            'Cave',
        ),
        'w',
        {
            outline: [
                [2, 2],
                [12, 2],
                [12, 8],
            ],
        },
    )
    editor.load({
        ...state,
        map: hasTrace
            ? { ...state.map, trace: { x: 1, y: 1, width: 5, opacity: 0.5 } }
            : state.map,
    })
    const wrapper = mount(MapEditorHallTab, {
        props: { editor, hasTrace },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UFormField: { template: '<div><slot /></div>' },
                LayoutEyebrow: { template: '<p><slot /></p>' },
                UInput: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input v-bind="$attrs" :value="modelValue"
                        @input="$emit('update:modelValue', $event.target.value)" />`,
                },
                UButton: {
                    inheritAttrs: false,
                    props: ['type', 'disabled'],
                    emits: ['click'],
                    template: `<button :type="type ?? 'button'" :disabled="disabled"
                        :data-testid="$attrs['data-testid']" @click="$emit('click')"><slot /></button>`,
                },
                UFileUpload: {
                    emits: ['update:modelValue'],
                    setup: () => ({ pick: () => nextFile }),
                    template: `<button data-testid="map-editor-trace-upload"
                        @click="$emit('update:modelValue', pick())" />`,
                },
                USlider: {
                    emits: ['update:modelValue', 'change'],
                    template: '<div data-testid="slider" />',
                },
                UInputNumber: {
                    emits: ['update:modelValue'],
                    template: '<div data-testid="trace-number" />',
                },
            },
        },
    })
    const size = async (width: string, height: string) => {
        await wrapper.get('[data-testid="map-editor-width"]').setValue(width)
        await wrapper.get('[data-testid="map-editor-height"]').setValue(height)
    }
    const apply = () => wrapper.get('button[type="submit"]')
    return { editor, wrapper, size, apply }
}

describe('MapEditorHallTab', () => {
    it('resizes the hall as one undo step once the size changed', async () => {
        const { editor, wrapper, size, apply } = setup()
        expect(apply().attributes('disabled')).toBeDefined()

        await size('30', '25')
        expect(apply().attributes('disabled')).toBeUndefined()
        await wrapper.get('form').trigger('submit')
        expect(editor.state.value.map).toMatchObject({ width: 30, height: 25 })

        editor.undo()
        await nextTick()
        expect(
            (
                wrapper.get('[data-testid="map-editor-width"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('20')
    })

    it('refuses a size that would cut off walls', async () => {
        const { editor, wrapper, size } = setup()
        await size('10', '20')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.text()).toContain('mapEditor.resizeTooSmall')
        expect(editor.canUndo.value).toBe(false)

        await size('12', '20')
        await wrapper.get('form').trigger('submit')
        expect(wrapper.text()).not.toContain('mapEditor.resizeTooSmall')
        expect(editor.state.value.map.width).toBe(12)
    })

    it('hands a picked trace file to the page and offers no trace tools before one exists', async () => {
        const { wrapper } = setup(false)
        expect(wrapper.find('[data-testid="slider"]').exists()).toBe(false)
        const file = new File(['x'], 'plan.png', { type: 'image/png' })
        nextFile = file
        await wrapper
            .get('[data-testid="map-editor-trace-upload"]')
            .trigger('click')
        expect(wrapper.emitted('uploadTrace')).toEqual([[file]])
    })

    it('previews opacity while sliding and records it as one undo step', async () => {
        const { editor, wrapper } = setup()
        const slider = wrapper.getComponent('[data-testid="slider"]')
        slider.vm.$emit('update:modelValue', 0.7)
        slider.vm.$emit('update:modelValue', 0.9)
        expect(editor.state.value.map.trace?.opacity).toBe(0.9)
        expect(editor.canUndo.value).toBe(false)
        slider.vm.$emit('change')

        editor.undo()
        expect(editor.state.value.map.trace?.opacity).toBe(0.5)
        expect(editor.canUndo.value).toBe(false)
    })

    it('moves and scales the trace, ignoring invalid numbers, and fits it to the hall', async () => {
        const { editor, wrapper } = setup()
        const [x, , width] = wrapper.findAllComponents(
            '[data-testid="trace-number"]',
        )
        x!.vm.$emit('update:modelValue', 3)
        width!.vm.$emit('update:modelValue', 0)
        width!.vm.$emit('update:modelValue', Number.NaN)
        width!.vm.$emit('update:modelValue', 5)
        expect(editor.state.value.map.trace).toMatchObject({ x: 3, width: 5 })
        editor.undo()
        expect(editor.canUndo.value).toBe(false)

        await wrapper
            .get('[data-testid="map-editor-trace-fit"]')
            .trigger('click')
        expect(editor.state.value.map.trace).toMatchObject({
            x: 0,
            y: 0,
            width: 20,
        })

        await wrapper
            .get('[data-testid="map-editor-trace-remove"]')
            .trigger('click')
        expect(wrapper.emitted('removeTrace')).toHaveLength(1)
    })
})
