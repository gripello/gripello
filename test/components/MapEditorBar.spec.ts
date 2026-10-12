import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EditorBar from '~/components/map/EditorBar.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { addWall, newFloorPlan, updateWall } from '~/utils/mapEditor'

const buttonStub = {
    props: ['disabled'],
    emits: ['click'],
    template:
        '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

function setup() {
    const editor = useMapEditor()
    editor.load({ map: newFloorPlan(10, 10), walls: [] })
    const wrapper = mount(EditorBar, {
        props: { editor },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UButton: buttonStub,
                UBadge: {
                    props: ['label'],
                    template: '<span v-bind="$attrs">{{ label }}</span>',
                },
                UIcon: true,
            },
        },
    })
    return { editor, wrapper }
}

describe('MapEditorBar', () => {
    it('stays hidden with nothing to do', () => {
        const { wrapper } = setup()
        expect(wrapper.find('[data-testid="map-editor-bar"]').exists()).toBe(
            false,
        )
    })

    it('finishes and cancels a drawing', async () => {
        const { editor, wrapper } = setup()
        editor.selectTool('shape')
        await wrapper.vm.$nextTick()
        const finish = () => wrapper.get('[data-testid="map-editor-finish"]')
        expect(finish().attributes('disabled')).toBeDefined()

        editor.draft.value = [
            [1, 1],
            [2, 1],
            [2, 2],
        ]
        await wrapper.vm.$nextTick()
        await wrapper
            .get('[data-testid="map-editor-undo-point"]')
            .trigger('click')
        expect(editor.draft.value).toHaveLength(2)

        await wrapper.get('[data-testid="map-editor-cancel"]').trigger('click')
        expect(editor.tool.value).toBe('select')
        expect(editor.draft.value).toEqual([])
    })

    it('shows which wall step is being drawn', async () => {
        const { editor, wrapper } = setup()
        editor.addNewWall('Cave')
        await wrapper.vm.$nextTick()
        expect(
            wrapper
                .get('[data-testid="map-editor-step-outline"]')
                .attributes('data-state'),
        ).toBe('active')
        expect(
            wrapper
                .get('[data-testid="map-editor-step-edge"]')
                .attributes('data-state'),
        ).toBe('todo')
    })

    it('leads an unfinished wall to its missing step', async () => {
        const { editor, wrapper } = setup()
        editor.commit(
            updateWall(addWall(editor.state.value, 'w', 'Cave'), 'w', {
                outline: [
                    [1, 1],
                    [2, 1],
                    [2, 2],
                ],
            }),
        )
        await wrapper.setProps({ incompleteWall: editor.state.value.walls[0] })
        expect(wrapper.text()).toContain('mapEditor.missing.edge')

        await wrapper
            .get('[data-testid="map-editor-finish-wall"]')
            .trigger('click')
        expect(editor.selectedWall.value?.key).toBe('w')
        expect(editor.tool.value).toBe('edge')
    })

    it('keeps the last points of a path', async () => {
        const { editor, wrapper } = setup()
        editor.selection.value = { kind: 'shape', index: 0 }
        editor.selectedVertex.value = {
            path: { type: 'shape', index: 0 },
            index: 0,
        }
        editor.commit({
            ...editor.state.value,
            map: {
                ...editor.state.value.map,
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
            },
        })
        editor.selectedVertex.value = {
            path: { type: 'shape', index: 0 },
            index: 0,
        }
        await wrapper.vm.$nextTick()
        expect(
            wrapper
                .get('[data-testid="map-editor-delete-point"]')
                .attributes('disabled'),
        ).toBeDefined()
        expect(wrapper.text()).toContain('mapEditor.minPoints')
    })
})
