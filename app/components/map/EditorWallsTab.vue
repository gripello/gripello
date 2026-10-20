<template>
    <div class="panel-tab">
        <UButton
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            data-testid="map-editor-add-wall"
            @click="newWall"
        >
            {{ $t('mapEditor.newWall') }}
        </UButton>

        <LayoutListGroup v-if="sortedWalls.length">
            <li
                v-for="(wall, index) in sortedWalls"
                :key="wall.key"
                class="panel-row"
                :class="{
                    'panel-row--active':
                        wall.key === editor.selectedWall.value?.key,
                }"
                data-testid="map-editor-wall-item"
                :data-name="wall.name"
            >
                <button
                    type="button"
                    class="panel-row__main"
                    :aria-pressed="wall.key === editor.selectedWall.value?.key"
                    @click="selectWall(wall.key)"
                >
                    {{ wall.name || $t('mapEditor.missing.name') }}
                </button>
                <UBadge
                    v-bind="wallStatus(wall)"
                    size="sm"
                    variant="subtle"
                    class="shrink-0"
                />
                <UDropdownMenu :items="wallMenu(wall, index)">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        square
                        :aria-label="$t('mapEditor.wallActions')"
                    />
                </UDropdownMenu>
            </li>
        </LayoutListGroup>

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
                <UFormField :label="$t('mapEditor.anchorFrom')" class="flex-1">
                    <UInputNumber
                        :model-value="editor.selectedWall.value.anchorFrom"
                        :min="1"
                        class="w-full"
                        data-testid="map-editor-wall-anchor-from"
                        @update:model-value="setAnchor('anchorFrom', $event)"
                    />
                </UFormField>
                <UFormField :label="$t('mapEditor.anchorTo')" class="flex-1">
                    <UInputNumber
                        :model-value="editor.selectedWall.value.anchorTo"
                        :min="1"
                        class="w-full"
                        data-testid="map-editor-wall-anchor-to"
                        @update:model-value="setAnchor('anchorTo', $event)"
                    />
                </UFormField>
            </div>
            <UStepper
                :items="steps"
                :model-value="currentStep"
                orientation="vertical"
                size="sm"
                :linear="false"
                @update:model-value="startStep"
            >
                <template #description="{ item }">
                    <UButton
                        color="primary"
                        variant="link"
                        size="sm"
                        class="px-0"
                        :data-testid="item.testId"
                        @click.stop="startStep(item.value)"
                    >
                        {{ item.action }}
                    </UButton>
                </template>
            </UStepper>
            <div class="flex flex-wrap items-center gap-2">
                <UButton
                    size="sm"
                    variant="ghost"
                    color="error"
                    icon="i-lucide-trash-2"
                    :disabled="selectedWallRoutes > 0"
                    data-testid="map-editor-delete-wall"
                    @click="deleteWall(editor.selectedWall.value)"
                >
                    {{ $t('mapEditor.deleteWall') }}
                </UButton>
                <span
                    v-if="selectedWallRoutes > 0"
                    class="text-xs text-muted"
                    data-testid="map-editor-wall-has-routes"
                >
                    {{ $t('mapEditor.routesOnWall', selectedWallRoutes) }}
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import {
    moveWall,
    nextWallName,
    removeWall,
    updateWall,
    wallProblems,
    type EditorState,
    type EditorWall,
    type FloorPlanError,
} from '~/utils/mapEditor'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    routeCounts: Map<string, number>
    saveErrors: FloorPlanError[]
}>()

const emit = defineEmits<{ deleted: [name: string] }>()

const saveErrorText = useFloorPlanErrorText()
const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)

const sortedWalls = computed(() =>
    [...state.value.walls].sort((a, b) => a.sort - b.sort),
)

function commit(next: EditorState) {
    editor.commit(next)
}

function wallStatus(wall: EditorWall) {
    const failed = props.saveErrors.find((error) => error.key === wall.key)
    if (failed)
        return {
            color: 'error' as const,
            icon: 'i-lucide-circle-x',
            label: saveErrorText(failed),
        }
    const [problem] = wallProblems(wall, state.value.walls)
    if (problem)
        return {
            color: 'warning' as const,
            icon: 'i-lucide-triangle-alert',
            label: t(`mapEditor.missing.${problem}`),
        }
    return {
        color: 'success' as const,
        icon: 'i-lucide-check',
        label: t('mapEditor.complete'),
    }
}

function wallMenu(wall: EditorWall, index: number): DropdownMenuItem[][] {
    return [
        [
            {
                label: t('mapEditor.moveUp'),
                icon: 'i-lucide-arrow-up',
                disabled: index === 0,
                onSelect: () => commit(moveWall(state.value, wall.key, -1)),
            },
            {
                label: t('mapEditor.moveDown'),
                icon: 'i-lucide-arrow-down',
                disabled: index === sortedWalls.value.length - 1,
                onSelect: () => commit(moveWall(state.value, wall.key, 1)),
            },
        ],
        [
            {
                label: t('mapEditor.deleteWall'),
                icon: 'i-lucide-trash-2',
                color: 'error',
                disabled: routesOn(wall) > 0,
                onSelect: () => deleteWall(wall),
            },
        ],
    ]
}

function selectWall(key: string) {
    editor.selectTool('select')
    editor.selection.value = { kind: 'wall', key }
    editor.selectedVertex.value = null
}

function newWall() {
    editor.addNewWall(
        nextWallName(state.value.walls, (n) =>
            t('mapEditor.defaultWallName', { n }),
        ),
    )
}

const steps = computed(() => {
    const wall = editor.selectedWall.value
    const has = {
        outline: !!wall && wall.outline.length >= 3,
        edge: !!wall && wall.edge.length >= 2,
    }
    return [
        {
            value: 0,
            title: t('mapEditor.steps.outline'),
            action: t(has.outline ? 'mapEditor.redraw' : 'mapEditor.draw'),
            testId: 'map-editor-draw-outline',
        },
        {
            value: 1,
            title: t('mapEditor.steps.edge'),
            action: t(has.edge ? 'mapEditor.redraw' : 'mapEditor.draw'),
            testId: 'map-editor-draw-edge',
        },
        {
            value: 2,
            title: t('mapEditor.steps.label'),
            action: t('mapEditor.moveLabel'),
            testId: 'map-editor-place-label',
        },
    ]
})

const currentStep = computed(() => {
    const wall = editor.selectedWall.value
    if (!wall) return 0
    const problems = wallProblems(wall)
    if (problems.includes('outline')) return 0
    if (problems.includes('edge')) return 1
    return 3
})

const STEP_TOOLS = ['outline', 'edge', 'label'] as const

function startStep(step: string | number | undefined) {
    const tool = STEP_TOOLS[Number(step)]
    if (tool) editor.selectTool(tool)
}

function renameWall(event: Event) {
    const wall = editor.selectedWall.value
    const name = (event.target as HTMLInputElement).value.trim()
    if (!wall || !name || name === wall.name) return
    commit(updateWall(state.value, wall.key, { name }))
}

function setAnchor(
    field: 'anchorFrom' | 'anchorTo',
    raw: number | null | undefined,
) {
    const wall = editor.selectedWall.value
    if (!wall) return
    const value = typeof raw === 'number' && raw > 0 ? Math.round(raw) : null
    if (value === wall[field]) return
    commit(updateWall(state.value, wall.key, { [field]: value }))
}

function routesOn(wall: EditorWall) {
    return wall.id ? (props.routeCounts.get(wall.id) ?? 0) : 0
}

const selectedWallRoutes = computed(() =>
    editor.selectedWall.value ? routesOn(editor.selectedWall.value) : 0,
)

function deleteWall(wall: EditorWall) {
    if (routesOn(wall) > 0) return
    commit(removeWall(state.value, wall.key))
    if (editor.selection.value?.kind === 'wall') editor.selection.value = null
    emit('deleted', wall.name)
}
</script>
