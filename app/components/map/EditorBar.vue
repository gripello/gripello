<template>
    <div
        v-if="mode"
        class="editor-bar"
        :class="{ 'editor-bar--warning': mode === 'incomplete' }"
        role="status"
        aria-live="polite"
        data-testid="map-editor-bar"
    >
        <template v-if="mode === 'drawing'">
            <span class="editor-bar__title">{{ title }}</span>
            <template v-if="wallSteps">
                <UBadge
                    v-for="step in wallSteps"
                    :key="step.key"
                    :color="step.state === 'active' ? 'primary' : 'neutral'"
                    :variant="step.state === 'active' ? 'solid' : 'subtle'"
                    :icon="step.state === 'done' ? 'i-lucide-check' : undefined"
                    :data-state="step.state"
                    :data-testid="`map-editor-step-${step.key}`"
                    :label="step.label"
                />
            </template>
            <span class="text-xs text-muted">
                {{ $t('mapEditor.points', editor.draft.value.length) }}
            </span>
            <span class="editor-bar__actions">
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-undo-dot"
                    :disabled="!editor.draft.value.length"
                    data-testid="map-editor-undo-point"
                    @click="
                        editor.draft.value = editor.draft.value.slice(0, -1)
                    "
                >
                    {{ $t('mapEditor.undoPoint') }}
                </UButton>
                <UButton
                    color="primary"
                    size="sm"
                    icon="i-lucide-check"
                    :disabled="!editor.canFinish.value"
                    data-testid="map-editor-finish"
                    @click="editor.finishDraft()"
                >
                    {{ $t('mapEditor.finish') }}
                </UButton>
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    icon="i-lucide-x"
                    :aria-label="$t('actions.cancel')"
                    data-testid="map-editor-cancel"
                    @click="editor.selectTool('select')"
                />
            </span>
        </template>

        <template v-else-if="mode === 'label'">
            <span class="editor-bar__title">{{ title }}</span>
            <UBadge color="primary" :label="$t('mapEditor.steps.label')" />
            <span class="editor-bar__actions">
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    icon="i-lucide-x"
                    :aria-label="$t('actions.cancel')"
                    data-testid="map-editor-cancel"
                    @click="editor.selectTool('select')"
                />
            </span>
        </template>

        <template v-else-if="mode === 'point'">
            <span class="editor-bar__title">
                {{
                    $t('mapEditor.pointLabel', {
                        n: (editor.selectedVertex.value?.index ?? 0) + 1,
                    })
                }}
            </span>
            <span class="editor-bar__actions">
                <span v-if="atMinimum" class="text-xs text-muted">
                    {{ $t('mapEditor.minPoints', { n: minimum }) }}
                </span>
                <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-trash-2"
                    :disabled="atMinimum"
                    data-testid="map-editor-delete-point"
                    @click="editor.removeSelectedVertex()"
                >
                    {{ $t('mapEditor.deletePoint') }}
                </UButton>
            </span>
        </template>

        <template v-else-if="mode === 'wall'">
            <span class="editor-bar__title">{{ title }}</span>
            <span class="editor-bar__actions">
                <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-tag"
                    data-testid="map-editor-move-label"
                    @click="editor.selectTool('label')"
                >
                    {{ $t('mapEditor.placeLabel') }}
                </UButton>
            </span>
        </template>

        <template v-else-if="mode === 'incomplete' && unfinished">
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
            <span class="editor-bar__title">
                {{ unfinished.name }} ·
                {{ missingText }}
            </span>
            <span class="editor-bar__actions">
                <UButton
                    color="warning"
                    variant="soft"
                    size="sm"
                    data-testid="map-editor-finish-wall"
                    @click="finishWall(unfinished)"
                >
                    {{ $t('mapEditor.finishIt') }}
                </UButton>
            </span>
        </template>
    </div>
</template>

<script setup lang="ts">
import {
    minPointsFor,
    readPath,
    wallProblems,
    type EditorWall,
} from '~/utils/mapEditor'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    incompleteWall?: EditorWall | null
}>()

const { t } = useI18n()
const editor = props.editor

const unfinished = computed(() => {
    const selected = editor.selectedWall.value
    if (selected)
        return wallProblems(selected, editor.state.value.walls).length
            ? selected
            : null
    return editor.selection.value ? null : (props.incompleteWall ?? null)
})

const mode = computed(() => {
    const tool = editor.tool.value
    if (editor.isDrawing.value) return 'drawing'
    if (tool === 'label') return 'label'
    if (editor.selectedVertex.value) return 'point'
    if (unfinished.value) return 'incomplete'
    if (editor.selectedWall.value) return 'wall'
    return null
})

const title = computed(() => {
    if (editor.tool.value === 'shape')
        return t(`mapEditor.kinds.${editor.shapeKind.value}`)
    return editor.selectedWall.value?.name ?? ''
})

const wallSteps = computed(() => {
    const tool = editor.tool.value
    if (tool !== 'outline' && tool !== 'edge') return null
    const wall = editor.selectedWall.value
    const state = (key: 'outline' | 'edge') => {
        if (tool === key) return 'active'
        const points = key === 'outline' ? wall?.outline : wall?.edge
        return (points?.length ?? 0) >= (key === 'outline' ? 3 : 2)
            ? 'done'
            : 'todo'
    }
    return [
        {
            key: 'outline',
            label: t('mapEditor.steps.outline'),
            state: state('outline'),
        },
        {
            key: 'edge',
            label: t('mapEditor.steps.edge'),
            state: state('edge'),
        },
    ]
})

const minimum = computed(() => {
    const selected = editor.selectedVertex.value
    return selected ? minPointsFor(editor.state.value, selected.path) : 0
})

const atMinimum = computed(() => {
    const selected = editor.selectedVertex.value
    return (
        !!selected &&
        readPath(editor.state.value, selected.path).length <= minimum.value
    )
})

const missingText = computed(() =>
    unfinished.value
        ? wallProblems(unfinished.value, editor.state.value.walls)
              .map((problem) => t(`mapEditor.missing.${problem}`))
              .join(', ')
        : '',
)

function finishWall(wall: EditorWall) {
    editor.selection.value = { kind: 'wall', key: wall.key }
    editor.selectedVertex.value = null
    const problems = wallProblems(wall)
    if (problems.includes('outline')) editor.selectTool('outline')
    else if (problems.includes('edge')) editor.selectTool('edge')
    else editor.selectTool('select')
}
</script>

<style scoped>
.editor-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    max-width: 100%;
    padding: 6px 6px 6px 14px;
    border-radius: calc(var(--ui-radius) * 3);
    background: var(--ui-bg);
    box-shadow:
        0 0 0 1px var(--ui-border),
        0 8px 24px rgb(0 0 0 / 0.14);
    font-size: 0.875rem;
    pointer-events: auto;
}

.editor-bar--warning {
    background: color-mix(in oklab, var(--ui-warning) 10%, var(--ui-bg));
    color: var(--ui-warning);
}

.editor-bar__title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--ui-text-highlighted);
}

.editor-bar--warning .editor-bar__title {
    color: inherit;
}

.editor-bar__actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
}
</style>
