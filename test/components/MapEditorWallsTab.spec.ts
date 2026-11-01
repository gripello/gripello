import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import MapEditorWallsTab from '~/components/map/EditorWallsTab.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import {
    addWall,
    newFloorPlan,
    updateWall,
    type EditorState,
    type FloorPlanError,
} from '~/utils/mapEditor'

beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal(
        'useFloorPlanErrorText',
        () => (error: FloorPlanError) => error.message,
    )
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: { n: number }) =>
            params ? `${key}:${params.n}` : key,
    }))
})

const complete = {
    outline: [
        [0, 0],
        [2, 0],
        [2, 2],
    ] as [number, number][],
    edge: [
        [0, 0],
        [2, 0],
    ] as [number, number][],
}

function state(): EditorState {
    let next: EditorState = { map: newFloorPlan(10, 10), walls: [] }
    next = addWall(next, 'a', 'Cave')
    next = addWall(next, 'b', 'Slab')
    next = addWall(next, 'c', 'cave')
    next = updateWall(next, 'a', { ...complete, id: 'wall-a' } as never)
    return updateWall(next, 'b', complete)
}

function setup(
    options: {
        routeCounts?: Map<string, number>
        saveErrors?: FloorPlanError[]
    } = {},
) {
    const editor = useMapEditor()
    editor.load(state())
    const wrapper = mount(MapEditorWallsTab, {
        props: {
            editor,
            routeCounts: options.routeCounts ?? new Map(),
            saveErrors: options.saveErrors ?? [],
        },
        global: {
            mocks: {
                $t: (key: string, n?: number) =>
                    n === undefined ? key : `${key}:${n}`,
            },
            stubs: {
                LayoutListGroup: { template: '<ul><slot /></ul>' },
                UFormField: { template: '<div><slot /></div>' },
                UButton: {
                    inheritAttrs: false,
                    props: ['disabled'],
                    emits: ['click'],
                    template: `<button :disabled="disabled" :data-testid="$attrs['data-testid']"
                        @click="$emit('click', $event)"><slot /></button>`,
                },
                UBadge: {
                    props: ['label', 'color'],
                    template:
                        '<span data-testid="wall-status" :data-color="color">{{ label }}</span>',
                },
                UDropdownMenu: {
                    props: ['items'],
                    template: `<div><button v-for="entry in items.flat()" :key="entry.label"
                        data-testid="wall-menu" :disabled="entry.disabled"
                        @click="entry.onSelect()">{{ entry.label }}</button></div>`,
                },
                UInput: {
                    inheritAttrs: false,
                    props: ['modelValue'],
                    emits: ['change'],
                    template: `<input :data-testid="$attrs['data-testid']" :value="modelValue"
                        @change="$emit('change', $event)" />`,
                },
                UInputNumber: {
                    inheritAttrs: false,
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<span :data-testid="$attrs[\'data-testid\']">{{ modelValue }}</span>',
                },
                UStepper: {
                    props: ['items', 'modelValue'],
                    emits: ['update:modelValue'],
                    template: `<div data-testid="steps" :data-step="modelValue">
                        <template v-for="item in items" :key="item.value">
                            <slot name="description" :item="item" />
                        </template></div>`,
                },
            },
        },
    })
    const rows = () => wrapper.findAll('[data-testid="map-editor-wall-item"]')
    const menu = (row: number) =>
        rows()[row]!.findAll('[data-testid="wall-menu"]')
    return { editor, wrapper, rows, menu }
}

describe('MapEditorWallsTab', () => {
    it('shows each wall as complete, incomplete or failed to save', () => {
        const { rows } = setup({
            saveErrors: [
                { key: 'b', name: 'Slab', code: 'x', message: 'too long' },
            ],
        })
        const status = rows().map((row) => [
            row.attributes('data-name'),
            row.get('[data-testid="wall-status"]').attributes('data-color'),
            row.get('[data-testid="wall-status"]').text(),
        ])
        expect(status).toEqual([
            ['Cave', 'warning', 'mapEditor.missing.duplicate'],
            ['Slab', 'error', 'too long'],
            ['cave', 'warning', 'mapEditor.missing.duplicate'],
        ])
    })

    it('selects a wall from the list and walks it to the first missing step', async () => {
        const { editor, wrapper, rows } = setup()
        editor.selectTool('trace')
        await rows()[2]!.get('button').trigger('click')
        expect(editor.selection.value).toEqual({ kind: 'wall', key: 'c' })
        expect(editor.tool.value).toBe('select')
        expect(rows()[2]!.classes()).toContain('panel-row--active')
        expect(
            wrapper.get('[data-testid="steps"]').attributes('data-step'),
        ).toBe('0')
        expect(
            wrapper.get('[data-testid="map-editor-draw-outline"]').text(),
        ).toBe('mapEditor.draw')

        await wrapper
            .get('[data-testid="map-editor-draw-edge"]')
            .trigger('click')
        expect(editor.tool.value).toBe('edge')
        wrapper
            .getComponent('[data-testid="steps"]')
            .vm.$emit('update:modelValue', 2)
        expect(editor.tool.value).toBe('label')

        await rows()[1]!.get('button').trigger('click')
        expect(
            wrapper.get('[data-testid="steps"]').attributes('data-step'),
        ).toBe('3')
        expect(
            wrapper.get('[data-testid="map-editor-draw-outline"]').text(),
        ).toBe('mapEditor.redraw')
    })

    it('renames only to a new, non-blank name', async () => {
        const { editor, wrapper } = setup()
        editor.selection.value = { kind: 'wall', key: 'b' }
        await wrapper.vm.$nextTick()
        const name = wrapper.get('[data-testid="map-editor-wall-name"]')
        await name.setValue('   ')
        await name.setValue('Slab')
        expect(editor.canUndo.value).toBe(false)
        await name.setValue('  Roof ')
        expect(editor.selectedWall.value?.name).toBe('Roof')
    })

    it('stores anchors as positive whole numbers and clears invalid ones', async () => {
        const { editor, wrapper } = setup()
        editor.selection.value = { kind: 'wall', key: 'b' }
        await wrapper.vm.$nextTick()
        const from = wrapper.getComponent(
            '[data-testid="map-editor-wall-anchor-from"]',
        )
        from.vm.$emit('update:modelValue', 3.6)
        expect(editor.selectedWall.value?.anchorFrom).toBe(4)
        from.vm.$emit('update:modelValue', 4)
        expect(editor.canUndo.value).toBe(true)
        editor.undo()
        editor.redo()
        wrapper
            .getComponent('[data-testid="map-editor-wall-anchor-to"]')
            .vm.$emit('update:modelValue', -2)
        expect(editor.selectedWall.value?.anchorTo).toBeNull()
        from.vm.$emit('update:modelValue', 0)
        expect(editor.selectedWall.value?.anchorFrom).toBeNull()
    })

    it('reorders walls from the menu, never past either end', async () => {
        const { editor, menu, rows } = setup()
        expect(menu(0)[0]!.attributes('disabled')).toBeDefined()
        expect(menu(2)[1]!.attributes('disabled')).toBeDefined()
        await menu(0)[1]!.trigger('click')
        expect(rows().map((row) => row.attributes('data-name'))).toEqual([
            'Slab',
            'Cave',
            'cave',
        ])
        await menu(2)[0]!.trigger('click')
        expect(rows().map((row) => row.attributes('data-name'))).toEqual([
            'Slab',
            'cave',
            'Cave',
        ])
        expect(
            editor.state.value.walls.map((wall) => wall.sort).sort(),
        ).toEqual([1, 2, 3])
    })

    it('keeps walls that still carry routes', async () => {
        const { editor, wrapper, menu } = setup({
            routeCounts: new Map([['wall-a', 2]]),
        })
        expect(menu(0)[2]!.attributes('disabled')).toBeDefined()
        editor.selection.value = { kind: 'wall', key: 'a' }
        await wrapper.vm.$nextTick()
        expect(
            wrapper
                .get('[data-testid="map-editor-delete-wall"]')
                .attributes('disabled'),
        ).toBeDefined()
        expect(
            wrapper.get('[data-testid="map-editor-wall-has-routes"]').text(),
        ).toBe('mapEditor.routesOnWall:2')

        await menu(1)[2]!.trigger('click')
        expect(editor.state.value.walls.map((wall) => wall.key)).toEqual([
            'a',
            'c',
        ])
        expect(editor.selection.value).toBeNull()
        expect(wrapper.emitted('deleted')).toEqual([['Slab']])
    })

    it('names a new wall after the first free number', async () => {
        const { editor, wrapper } = setup()
        editor.commit(
            updateWall(editor.state.value, 'c', {
                name: 'mapEditor.defaultWallName:4',
            }),
        )
        await wrapper
            .get('[data-testid="map-editor-add-wall"]')
            .trigger('click')
        expect(editor.selectedWall.value?.name).toBe(
            'mapEditor.defaultWallName:5',
        )
        expect(editor.tool.value).toBe('outline')
    })
})
