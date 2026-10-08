<template>
    <div class="editor-panel" data-testid="map-editor-panel">
        <section class="panel-section">
            <LayoutEyebrow>{{ $t('mapEditor.walls') }}</LayoutEyebrow>
            <form class="panel-row" @submit.prevent="submitWall">
                <UFormField :label="$t('mapEditor.newWall')" class="flex-1">
                    <UInput
                        v-model="newWallName"
                        :maxlength="100"
                        class="w-full"
                        data-testid="map-editor-new-wall"
                    />
                </UFormField>
                <UButton
                    type="submit"
                    color="neutral"
                    variant="soft"
                    class="self-end"
                    :disabled="!newWallName.trim()"
                    data-testid="map-editor-add-wall"
                >
                    {{ $t('mapEditor.addWall') }}
                </UButton>
            </form>

            <div class="panel-list">
                <div
                    v-for="(wall, index) in sortedWalls"
                    :key="wall.key"
                    class="panel-item"
                    :class="{
                        'panel-item--active':
                            wall.key === editor.selectedWall.value?.key,
                    }"
                    data-testid="map-editor-wall-item"
                    :data-name="wall.name"
                    @click="selectWall(wall.key)"
                >
                    <button
                        type="button"
                        class="panel-item__main"
                        :aria-pressed="
                            wall.key === editor.selectedWall.value?.key
                        "
                    >
                        <span class="block truncate">{{ wall.name }}</span>
                        <span
                            v-if="wallProblems(wall).length"
                            class="block text-xs text-error"
                        >
                            {{ problemText(wall) }}
                        </span>
                    </button>
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-chevron-up"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="index === 0"
                        :aria-label="$t('mapEditor.moveUp')"
                        @click.stop="commit(moveWall(state, wall.key, -1))"
                    />
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-chevron-down"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="index === sortedWalls.length - 1"
                        :aria-label="$t('mapEditor.moveDown')"
                        @click.stop="commit(moveWall(state, wall.key, 1))"
                    />
                </div>
            </div>

            <div
                v-if="editor.selectedWall.value"
                class="panel-details"
                data-testid="map-editor-wall-details"
            >
                <UFormField :label="$t('mapEditor.wallName')">
                    <UInput
                        :model-value="editor.selectedWall.value.name"
                        :maxlength="100"
                        class="w-full"
                        data-testid="map-editor-wall-name"
                        @change="renameWall"
                    />
                </UFormField>
                <div class="flex gap-2">
                    <UFormField
                        :label="$t('mapEditor.anchorFrom')"
                        class="flex-1"
                    >
                        <UInput
                            :model-value="
                                editor.selectedWall.value.anchorFrom ??
                                undefined
                            "
                            type="number"
                            min="1"
                            class="w-full"
                            data-testid="map-editor-wall-anchor-from"
                            @change="setAnchor('anchorFrom', $event)"
                        />
                    </UFormField>
                    <UFormField
                        :label="$t('mapEditor.anchorTo')"
                        class="flex-1"
                    >
                        <UInput
                            :model-value="
                                editor.selectedWall.value.anchorTo ?? undefined
                            "
                            type="number"
                            min="1"
                            class="w-full"
                            data-testid="map-editor-wall-anchor-to"
                            @change="setAnchor('anchorTo', $event)"
                        />
                    </UFormField>
                </div>
                <p class="text-xs text-muted">
                    {{ $t('mapEditor.anchorHint') }}
                </p>
                <div class="panel-actions">
                    <UButton
                        size="sm"
                        v-bind="stepStyle('outline')"
                        icon="i-lucide-pentagon"
                        data-testid="map-editor-draw-outline"
                        @click="editor.selectTool('outline')"
                    >
                        {{ $t('mapEditor.drawOutline') }}
                    </UButton>
                    <UButton
                        size="sm"
                        v-bind="stepStyle('edge')"
                        icon="i-lucide-spline"
                        data-testid="map-editor-draw-edge"
                        @click="editor.selectTool('edge')"
                    >
                        {{ $t('mapEditor.drawEdge') }}
                    </UButton>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-tag"
                        @click="editor.selectTool('label')"
                    >
                        {{ $t('mapEditor.placeLabel') }}
                    </UButton>
                    <UButton
                        size="sm"
                        variant="ghost"
                        color="error"
                        icon="i-lucide-trash-2"
                        :disabled="selectedWallHasRoutes"
                        data-testid="map-editor-delete-wall"
                        @click="deleteWall"
                    >
                        {{ $t('mapEditor.deleteWall') }}
                    </UButton>
                </div>
                <p
                    v-if="selectedWallHasRoutes"
                    class="text-xs text-muted mt-2"
                    data-testid="map-editor-wall-has-routes"
                >
                    {{ $t('mapEditor.wallHasRoutes') }}
                </p>
            </div>
        </section>

        <section class="panel-section">
            <LayoutEyebrow>{{ $t('mapEditor.shapes') }}</LayoutEyebrow>
            <div class="panel-list">
                <button
                    v-for="(shape, index) in state.map.shapes"
                    :key="index"
                    type="button"
                    class="panel-item panel-shape"
                    :class="{
                        'panel-item--active': selectedShapeIndex === index,
                    }"
                    :aria-pressed="selectedShapeIndex === index"
                    data-testid="map-editor-shape-item"
                    @click="editor.selection.value = { kind: 'shape', index }"
                >
                    <UIcon
                        :name="SHAPE_ICONS[shape.kind]"
                        class="size-5 shrink-0"
                    />
                    {{ `${$t(`mapEditor.kinds.${shape.kind}`)} ${index + 1}` }}
                </button>
            </div>
            <div v-if="selectedShapeIndex !== null" class="panel-details">
                <UFormField :label="$t('mapEditor.shapeKind')">
                    <USelect
                        :model-value="
                            state.map.shapes[selectedShapeIndex]?.kind
                        "
                        :items="kindItems"
                        class="w-full"
                        @update:model-value="changeKind"
                    />
                </UFormField>
                <UButton
                    size="sm"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    class="self-start"
                    data-testid="map-editor-delete-shape"
                    @click="deleteShape"
                >
                    {{ $t('mapEditor.deleteShape') }}
                </UButton>
            </div>
        </section>

        <section class="panel-section">
            <LayoutEyebrow>{{ $t('mapEditor.canvas') }}</LayoutEyebrow>
            <form class="panel-row" @submit.prevent="resize">
                <UFormField :label="$t('mapEditor.width')" class="flex-1">
                    <UInput
                        v-model.number="width"
                        type="number"
                        class="w-full"
                        data-testid="map-editor-width"
                    >
                        <template #trailing>
                            <span class="text-xs text-muted">m</span>
                        </template>
                    </UInput>
                </UFormField>
                <UFormField :label="$t('mapEditor.height')" class="flex-1">
                    <UInput
                        v-model.number="height"
                        type="number"
                        class="w-full"
                        data-testid="map-editor-height"
                    >
                        <template #trailing>
                            <span class="text-xs text-muted">m</span>
                        </template>
                    </UInput>
                </UFormField>
                <UButton
                    type="submit"
                    color="neutral"
                    variant="soft"
                    class="self-end"
                    :disabled="
                        width === state.map.width && height === state.map.height
                    "
                >
                    {{ $t('mapEditor.apply') }}
                </UButton>
            </form>
            <p v-if="resizeError" class="text-xs text-error mt-1">
                {{ $t('mapEditor.resizeTooSmall') }}
            </p>
        </section>

        <section class="panel-section">
            <LayoutEyebrow>{{ $t('mapEditor.trace') }}</LayoutEyebrow>
            <p class="text-xs text-muted mb-2">
                {{ $t('mapEditor.traceHint') }}
            </p>
            <div class="panel-actions">
                <UButton
                    size="sm"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-image-plus"
                    :loading="traceBusy"
                    data-testid="map-editor-trace-upload"
                    @click="traceInput?.click()"
                >
                    {{
                        hasTrace
                            ? $t('mapEditor.replaceTrace')
                            : $t('mapEditor.uploadTrace')
                    }}
                </UButton>
                <UButton
                    v-if="hasTrace"
                    size="sm"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    :disabled="traceBusy"
                    @click="emit('removeTrace')"
                >
                    {{ $t('mapEditor.removeTrace') }}
                </UButton>
                <input
                    ref="traceInput"
                    type="file"
                    accept="image/jpeg,image/png,image/svg+xml,image/webp"
                    hidden
                    data-testid="map-editor-trace-file"
                    @change="onTraceChosen"
                />
            </div>
            <template v-if="hasTrace && state.map.trace">
                <UFormField :label="$t('mapEditor.traceOpacity')" class="mt-3">
                    <USlider
                        :model-value="state.map.trace.opacity"
                        :min="0.1"
                        :max="1"
                        :step="0.05"
                        @update:model-value="
                            (opacity) => setTrace({ opacity: Number(opacity) })
                        "
                    />
                </UFormField>
                <div class="panel-row mt-3">
                    <UFormField
                        v-for="traceField in traceFields"
                        :key="traceField.key"
                        :label="traceField.label"
                        class="flex-1"
                    >
                        <UInput
                            :model-value="state.map.trace[traceField.key]"
                            type="number"
                            class="w-full"
                            @change="setTraceNumber(traceField.key, $event)"
                        >
                            <template #trailing>
                                <span class="text-xs text-muted">m</span>
                            </template>
                        </UInput>
                    </UFormField>
                </div>
            </template>
        </section>
    </div>
</template>

<script setup lang="ts">
import {
    MAP_SHAPE_KINDS,
    type MapShapeKind,
    type MapTrace,
} from '#shared/utils/mapGeometry'
import {
    addWall,
    canResize,
    moveWall,
    removeShape,
    removeWall,
    setShapeKind,
    updateWall,
    wallProblems,
    type EditorState,
    type EditorWall,
} from '~/utils/mapEditor'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    hasTrace: boolean
    traceBusy: boolean
    wallsWithRoutes: Set<string>
}>()

const emit = defineEmits<{
    uploadTrace: [file: File]
    removeTrace: []
}>()

const SHAPE_ICONS: Record<MapShapeKind, string> = {
    floor: 'i-lucide-land-plot',
    mat: 'i-lucide-rectangle-horizontal',
    structure: 'i-lucide-box',
}

const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)
const traceInput = useTemplateRef<HTMLInputElement>('traceInput')

const newWallName = ref('')
const width = ref(state.value.map.width)
const height = ref(state.value.map.height)
const resizeError = ref(false)

watch(
    () => [state.value.map.width, state.value.map.height],
    ([nextWidth, nextHeight]) => {
        width.value = nextWidth!
        height.value = nextHeight!
    },
)

const sortedWalls = computed(() =>
    [...state.value.walls].sort((a, b) => a.sort - b.sort),
)
const selectedShapeIndex = computed(() =>
    editor.selection.value?.kind === 'shape'
        ? editor.selection.value.index
        : null,
)
const kindItems = computed(() =>
    MAP_SHAPE_KINDS.map((kind) => ({
        label: t(`mapEditor.kinds.${kind}`),
        value: kind,
    })),
)

const traceFields = computed(() => [
    { key: 'x' as const, label: 'X' },
    { key: 'y' as const, label: 'Y' },
    { key: 'width' as const, label: t('mapEditor.width') },
])

function commit(next: EditorState) {
    editor.commit(next)
}

function stepStyle(step: 'outline' | 'edge') {
    const wall = editor.selectedWall.value
    if (editor.tool.value === step)
        return { variant: 'solid' as const, color: 'primary' as const }
    if (wall && wallProblems(wall).includes(step))
        return { variant: 'soft' as const, color: 'warning' as const }
    return { variant: 'soft' as const, color: 'neutral' as const }
}

function problemText(wall: EditorWall) {
    return wallProblems(wall)
        .map((problem) => t(`mapEditor.missing.${problem}`))
        .join(' · ')
}

function selectWall(key: string) {
    editor.selectTool('select')
    editor.selection.value = { kind: 'wall', key }
    editor.selectedVertex.value = null
}

function submitWall() {
    const name = newWallName.value.trim()
    if (!name) return
    const key = `new-${Date.now()}`
    commit(addWall(state.value, key, name))
    newWallName.value = ''
    selectWall(key)
    editor.selectTool('outline')
}

function renameWall(event: Event) {
    const wall = editor.selectedWall.value
    const name = (event.target as HTMLInputElement).value.trim()
    if (!wall || !name || name === wall.name) return
    commit(updateWall(state.value, wall.key, { name }))
}

function setAnchor(field: 'anchorFrom' | 'anchorTo', event: Event) {
    const wall = editor.selectedWall.value
    if (!wall) return
    const raw = (event.target as HTMLInputElement).value
    const parsed = Math.round(Number(raw))
    const value = raw === '' || !(parsed > 0) ? null : parsed
    if (value === wall[field]) return
    commit(updateWall(state.value, wall.key, { [field]: value }))
}

const selectedWallHasRoutes = computed(() => {
    const wallId = editor.selectedWall.value?.id
    return !!wallId && props.wallsWithRoutes.has(wallId)
})

function deleteWall() {
    const wall = editor.selectedWall.value
    if (!wall || selectedWallHasRoutes.value) return
    commit(removeWall(state.value, wall.key))
    editor.selection.value = null
}

function changeKind(kind: MapShapeKind | null) {
    if (selectedShapeIndex.value === null || !kind) return
    commit(setShapeKind(state.value, selectedShapeIndex.value, kind))
}

function deleteShape() {
    if (selectedShapeIndex.value === null) return
    commit(removeShape(state.value, selectedShapeIndex.value))
    editor.selection.value = null
}

function resize() {
    const nextWidth = Number(width.value)
    const nextHeight = Number(height.value)
    resizeError.value = !canResize(state.value, nextWidth, nextHeight)
    if (resizeError.value) return
    commit({
        ...state.value,
        map: { ...state.value.map, width: nextWidth, height: nextHeight },
    })
}

function setTrace(patch: Partial<MapTrace>) {
    const trace = state.value.map.trace
    if (!trace) return
    commit({
        ...state.value,
        map: { ...state.value.map, trace: { ...trace, ...patch } },
    })
}

function setTraceNumber(key: 'x' | 'y' | 'width', event: Event) {
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isFinite(value) || (key === 'width' && value <= 0)) return
    setTrace({ [key]: value })
}

function onTraceChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) emit('uploadTrace', file)
}
</script>

<style scoped>
.editor-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 16px;
    overflow-y: auto;
}

.panel-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
}

.panel-item {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding-right: 4px;
    border-radius: 8px;
    cursor: pointer;
}

.panel-item:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.panel-item__main {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    padding: 6px 8px;
    text-align: left;
    font-size: 0.875rem;
}

.panel-shape {
    gap: 12px;
    padding: 6px 8px;
    text-align: left;
    font-size: 0.875rem;
}

.panel-item--active {
    color: var(--ui-primary);
    background: color-mix(in oklab, var(--ui-primary) 12%, transparent);
}

.panel-details {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 10px;
    padding: 12px;
    border-radius: 8px;
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.panel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
</style>
