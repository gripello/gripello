import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FloorTab from '~/components/map/EditorFloorTab.vue'
import WallsTab from '~/components/map/EditorWallsTab.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { addWall, newFloorPlan } from '~/utils/mapEditor'

vi.stubGlobal('useFloorPlanErrorText', () => () => '')

const buttonStub = {
    emits: ['click'],
    template:
        '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
}
const global = {
    mocks: { $t: (key: string) => key },
    stubs: {
        UButton: buttonStub,
        LayoutListGroup: { template: '<ul><slot /></ul>' },
        UBadge: true,
        UDropdownMenu: true,
        UFormField: true,
        UIcon: true,
        UStepper: true,
        USelect: true,
        SegmentedControl: true,
    },
}

function editorWith(state = { map: newFloorPlan(10, 10), walls: [] }) {
    const editor = useMapEditor()
    editor.load(state)
    return editor
}

describe('map editor panel tabs', () => {
    it('deletes the selected wall and reports its name for the undo toast', async () => {
        const editor = editorWith()
        editor.load({
            ...editor.state.value,
            ...addWall(editor.state.value, 'w', 'Cave'),
        })
        editor.selection.value = { kind: 'wall', key: 'w' }
        const tab = mount(WallsTab, {
            props: { editor, routeCounts: new Map(), saveErrors: [] },
            global,
        })
        await tab.get('[data-testid="map-editor-delete-wall"]').trigger('click')
        expect(editor.state.value.walls).toEqual([])
        expect(tab.emitted('deleted')).toEqual([['Cave']])
    })

    it('adds a wall with a numbered default name', async () => {
        const editor = editorWith()
        const tab = mount(WallsTab, {
            props: { editor, routeCounts: new Map(), saveErrors: [] },
            global,
        })
        await tab.get('[data-testid="map-editor-add-wall"]').trigger('click')
        expect(editor.state.value.walls).toHaveLength(1)
    })

    it('deletes the selected shape', async () => {
        const plan = newFloorPlan(10, 10)
        const editor = editorWith({
            map: {
                ...plan,
                shapes: [
                    {
                        kind: 'floor',
                        points: [
                            [0, 0],
                            [1, 0],
                            [1, 1],
                        ],
                    },
                ],
            } as never,
            walls: [],
        })
        editor.selection.value = { kind: 'shape', index: 0 }
        const tab = mount(FloorTab, { props: { editor }, global })
        await tab
            .get('[data-testid="map-editor-delete-shape"]')
            .trigger('click')
        expect(editor.state.value.map.shapes).toEqual([])
        expect(tab.emitted('deleted')).toHaveLength(1)
    })
})
