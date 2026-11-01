import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, watch } from 'vue'
import MapEditorPanel from '~/components/map/EditorPanel.vue'
import { useMapEditor } from '~/composables/useMapEditor'
import { addWall, newFloorPlan } from '~/utils/mapEditor'

const success = vi.fn()

beforeEach(() => {
    success.mockReset()
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ success }))
})

const tabStub = (name: string, events: string[]) => ({
    emits: events,
    template: `<div data-testid="${name}" />`,
})

function setup() {
    const editor = useMapEditor()
    editor.load(addWall({ map: newFloorPlan(10, 10), walls: [] }, 'w', 'Cave'))
    const wrapper = mount(MapEditorPanel, {
        props: {
            editor,
            hasTrace: false,
            routeCounts: new Map(),
            saveErrors: [],
        },
        global: {
            stubs: {
                LayoutTabs: {
                    props: ['modelValue', 'items'],
                    template: `<div data-testid="tabs" :data-tab="modelValue">
                        <span v-for="item in items" :key="item.value"
                            :data-testid="'tab-' + item.value">{{ item.badge }}</span>
                        <slot name="walls" /><slot name="floor" /><slot name="hall" /></div>`,
                },
                MapEditorWallsTab: tabStub('walls', ['deleted']),
                MapEditorFloorTab: tabStub('floor', ['deleted']),
                MapEditorHallTab: tabStub('hall', [
                    'uploadTrace',
                    'removeTrace',
                ]),
            },
        },
    })
    const tab = () => wrapper.get('[data-testid="tabs"]').attributes('data-tab')
    return { editor, wrapper, tab }
}

describe('MapEditorPanel', () => {
    it('follows the selection and the trace tool to the matching tab', async () => {
        const { editor, tab } = setup()
        expect(tab()).toBe('walls')
        editor.selection.value = { kind: 'shape', index: 0 }
        await nextTick()
        expect(tab()).toBe('floor')
        editor.selectTool('trace')
        await nextTick()
        expect(tab()).toBe('hall')
        editor.selection.value = { kind: 'wall', key: 'w' }
        await nextTick()
        expect(tab()).toBe('walls')
        editor.selection.value = null
        await nextTick()
        expect(tab()).toBe('walls')
    })

    it('counts walls and floor shapes on the tabs', async () => {
        const { editor, wrapper } = setup()
        expect(wrapper.get('[data-testid="tab-walls"]').text()).toBe('1')
        expect(wrapper.get('[data-testid="tab-floor"]').text()).toBe('1')
        editor.commit({
            map: { ...newFloorPlan(10, 10), shapes: [] },
            walls: [],
        })
        await nextTick()
        expect(wrapper.get('[data-testid="tab-walls"]').text()).toBe('')
        expect(wrapper.get('[data-testid="tab-floor"]').text()).toBe('')
    })

    it('offers to undo a deletion only while nothing changed since', async () => {
        const { editor, wrapper } = setup()
        editor.commit({ ...editor.state.value, walls: [] })
        wrapper
            .getComponent('[data-testid="walls"]')
            .vm.$emit('deleted', 'Cave')
        expect(success).toHaveBeenCalledWith('mapEditor.deleted', {
            label: 'mapEditor.undo',
            onClick: expect.any(Function),
        })
        const undo = success.mock.lastCall![1].onClick as () => void
        undo()
        expect(editor.state.value.walls).toHaveLength(1)

        editor.commit({ ...editor.state.value, walls: [] })
        wrapper
            .getComponent('[data-testid="floor"]')
            .vm.$emit('deleted', 'Floor')
        const later = success.mock.lastCall![1].onClick as () => void
        editor.commit(addWall(editor.state.value, 'x', 'New'))
        later()
        expect(editor.state.value.walls.map((wall) => wall.key)).toEqual(['x'])
    })

    it('passes trace uploads and removals up', () => {
        const { wrapper } = setup()
        const hall = wrapper.getComponent('[data-testid="hall"]')
        const file = new File(['x'], 'plan.png')
        hall.vm.$emit('uploadTrace', file)
        hall.vm.$emit('removeTrace')
        expect(wrapper.emitted('uploadTrace')).toEqual([[file]])
        expect(wrapper.emitted('removeTrace')).toHaveLength(1)
    })
})
