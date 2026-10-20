<template>
    <div class="panel-tab">
        <LayoutListGroup v-if="state.map.shapes.length">
            <li
                v-for="(shape, index) in state.map.shapes"
                :key="index"
                class="panel-row"
                :class="{
                    'panel-row--active': selectedShapeIndex === index,
                }"
            >
                <button
                    type="button"
                    class="panel-row__main panel-row__main--icon"
                    :aria-pressed="selectedShapeIndex === index"
                    data-testid="map-editor-shape-item"
                    @click="selectShape(index)"
                >
                    <UIcon
                        :name="SHAPE_ICONS[shape.kind]"
                        class="size-5 shrink-0"
                    />
                    {{ `${$t(`mapEditor.kinds.${shape.kind}`)} ${index + 1}` }}
                </button>
            </li>
        </LayoutListGroup>
        <div v-if="selectedShapeIndex !== null" class="panel-details">
            <UFormField :label="$t('mapEditor.shapeKind')">
                <USelect
                    :model-value="state.map.shapes[selectedShapeIndex]?.kind"
                    :items="kindItems"
                    class="w-full"
                    @update:model-value="changeKind"
                />
            </UFormField>
            <UFormField
                v-if="
                    state.map.shapes[selectedShapeIndex]?.kind === 'structure'
                "
                :label="$t('mapEditor.level')"
            >
                <SegmentedControl
                    :model-value="
                        String(state.map.shapes[selectedShapeIndex]?.level ?? 1)
                    "
                    :items="levelItems"
                    test-id="map-editor-shape-level"
                    @update:model-value="changeLevel"
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
    </div>
</template>

<script setup lang="ts">
import { MAP_SHAPE_KINDS, type MapShapeKind } from '#shared/utils/mapGeometry'
import {
    removeShape,
    setShapeKind,
    setShapeLevel,
    SHAPE_ICONS,
} from '~/utils/mapEditor'
import { translatedItems } from '~/utils/translatedItems'

const props = defineProps<{ editor: ReturnType<typeof useMapEditor> }>()

const emit = defineEmits<{ deleted: [name: string] }>()

const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)

const selectedShapeIndex = computed(() =>
    editor.selection.value?.kind === 'shape'
        ? editor.selection.value.index
        : null,
)
const kindItems = computed(() =>
    translatedItems(MAP_SHAPE_KINDS, 'mapEditor.kinds', t),
)
const levelItems = computed(() =>
    translatedItems(['1', '2', '3'] as const, 'mapEditor.levels', t),
)

function selectShape(index: number) {
    editor.selectTool('select')
    editor.selection.value = { kind: 'shape', index }
    editor.selectedVertex.value = null
}

function changeKind(kind: MapShapeKind | null) {
    if (selectedShapeIndex.value === null || !kind) return
    editor.commit(setShapeKind(state.value, selectedShapeIndex.value, kind))
}

function changeLevel(level: string) {
    if (selectedShapeIndex.value === null) return
    editor.commit(
        setShapeLevel(state.value, selectedShapeIndex.value, Number(level)),
    )
}

function deleteShape() {
    const index = selectedShapeIndex.value
    if (index === null) return
    const shape = state.value.map.shapes[index]!
    editor.commit(removeShape(state.value, index))
    editor.selection.value = null
    emit('deleted', `${t(`mapEditor.kinds.${shape.kind}`)} ${index + 1}`)
}
</script>
