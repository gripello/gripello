<template>
    <div class="editor-panel" data-testid="map-editor-panel">
        <LayoutTabs v-model="tab" :items="tabs" :unmount-on-hide="false">
            <template #walls>
                <MapEditorWallsTab
                    :editor="editor"
                    :route-counts="routeCounts"
                    :save-errors="saveErrors"
                    @deleted="undoable"
                />
            </template>

            <template #floor>
                <MapEditorFloorTab :editor="editor" @deleted="undoable" />
            </template>

            <template #hall>
                <MapEditorHallTab
                    :editor="editor"
                    :has-trace="hasTrace"
                    @upload-trace="emit('uploadTrace', $event)"
                    @remove-trace="emit('removeTrace')"
                />
            </template>
        </LayoutTabs>
    </div>
</template>

<script setup lang="ts">
import type { FloorPlanError } from '~/utils/mapEditor'

type PanelTab = 'walls' | 'floor' | 'hall'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    hasTrace: boolean
    routeCounts: Map<string, number>
    saveErrors: FloorPlanError[]
}>()

const emit = defineEmits<{
    uploadTrace: [file: File]
    removeTrace: []
}>()

const { success } = useNotification()
const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)

const tab = ref<PanelTab>('walls')

watch(
    () => editor.selection.value?.kind,
    (kind) => {
        if (kind === 'wall') tab.value = 'walls'
        else if (kind === 'shape') tab.value = 'floor'
    },
)

watch(editor.tool, (tool) => {
    if (tool === 'trace') tab.value = 'hall'
})

const tabs = computed(() => [
    {
        value: 'walls' as const,
        slot: 'walls' as const,
        label: t('mapEditor.walls'),
        badge: state.value.walls.length || undefined,
    },
    {
        value: 'floor' as const,
        slot: 'floor' as const,
        label: t('mapEditor.floor'),
        badge: state.value.map.shapes.length || undefined,
    },
    {
        value: 'hall' as const,
        slot: 'hall' as const,
        label: t('mapEditor.hall'),
    },
])

function undoable(name: string) {
    const after = editor.state.value
    success(t('mapEditor.deleted', { name }), {
        label: t('mapEditor.undo'),
        onClick: () => {
            if (editor.state.value === after) editor.undo()
        },
    })
}
</script>

<style scoped>
.editor-panel {
    display: flex;
    flex-direction: column;
    padding: 4px 16px 16px;
    overflow-y: auto;
}

.editor-panel :deep(.panel-tab) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 12px;
}

.editor-panel :deep(.panel-form) {
    display: flex;
    align-items: center;
    gap: 8px;
}

.editor-panel :deep(.panel-row) {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    padding-right: 4px;
}

.editor-panel :deep(.panel-row__main) {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 12px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.875rem;
    color: var(--ui-text-highlighted);
}

.editor-panel :deep(.panel-row__main--icon) {
    display: flex;
    align-items: center;
    gap: 12px;
}

.editor-panel :deep(.panel-row--active) {
    background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
    box-shadow: inset 3px 0 var(--ui-primary);
}

.editor-panel :deep(.panel-details) {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-bg-elevated);
}
</style>
