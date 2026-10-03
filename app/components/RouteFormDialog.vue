<template>
    <LayoutDialogShell
        v-model="dialogOpen"
        max-width="560"
        sheet-on-mobile
        :title="isEditMode ? $t('actions.edit') : $t('climbing.create')"
        :persistent="hasChanges"
        data-testid="route-form-dialog"
    >
        <UForm
            ref="formRef"
            :state="form"
            :validate="validateForm"
            class="flex flex-col gap-4"
            @submit="submit"
        >
            <UFormField
                :label="$t('routes.name')"
                name="name"
                :hint="`${form.name.length}/30`"
            >
                <UInput
                    v-model="form.name"
                    maxlength="30"
                    class="w-full"
                    data-testid="route-form-name"
                />
            </UFormField>

            <div class="grid grid-cols-2 gap-4">
                <UFormField :label="$t('climbing.type')" name="type">
                    <USelect
                        v-model="form.type"
                        :items="typeItems"
                        label-key="title"
                        class="w-full"
                        data-testid="route-form-type"
                    />
                </UFormField>
                <UFormField :label="gradeFieldLabel" name="grade">
                    <USelect
                        :model-value="form.grade ?? undefined"
                        :items="gradeLabels(gradeSystem)"
                        class="w-full"
                        data-testid="route-form-difficulty"
                        @update:model-value="form.grade = $event"
                    />
                </UFormField>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <UFormField
                    v-if="!isBoulderRoute"
                    :label="$t('climbing.anchor_point')"
                    name="anchor_point"
                >
                    <UInput
                        v-model.number="form.anchor_point"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        class="w-full"
                        data-testid="route-form-anchor-point"
                    />
                </UFormField>
                <UFormField
                    :label="$t('climbing.location')"
                    name="location"
                    :class="{ 'col-span-2': isBoulderRoute }"
                >
                    <USelect
                        v-model="form.location"
                        :items="locationRecords ?? []"
                        label-key="name"
                        value-key="id"
                        class="w-full"
                        data-testid="route-form-location"
                    />
                </UFormField>
            </div>

            <UFormField
                v-if="wallItems.length"
                :label="$t('map.wall')"
                :help="$t('map.wallHint')"
                name="wall"
            >
                <USelectMenu
                    :model-value="form.wall || undefined"
                    :items="wallItems"
                    label-key="title"
                    value-key="value"
                    :search-input="false"
                    clear
                    class="w-full"
                    data-testid="route-form-wall"
                    @update:model-value="form.wall = $event ?? ''"
                />
            </UFormField>

            <UFormField :label="$t('routes.route_setter')" name="creator">
                <UInputMenu
                    v-model="form.creator"
                    :items="setterItems"
                    multiple
                    create-item
                    class="w-full"
                    data-testid="route-form-creator"
                    @create="addCreator"
                />
            </UFormField>

            <div class="grid grid-cols-2 gap-4">
                <UFormField :label="$t('routes.screwed_at')" name="screw_date">
                    <UInput
                        v-model="form.screw_date"
                        type="date"
                        class="w-full"
                        data-testid="route-form-screw-date"
                    />
                </UFormField>
                <div v-if="isEditMode" class="flex items-center justify-center">
                    <USwitch
                        v-model="form.archived"
                        :label="$t('climbing.archived')"
                        data-testid="route-form-archived"
                    />
                </div>
            </div>

            <UFormField
                :label="$t('climbing.comment')"
                name="comment"
                :hint="`${form.comment.length}/255`"
            >
                <UTextarea
                    v-model="form.comment"
                    :rows="2"
                    autoresize
                    class="w-full"
                    data-testid="route-form-comment"
                />
            </UFormField>

            <UFormField :label="$t('climbing.color')">
                <div
                    class="flex flex-wrap items-center gap-2"
                    role="radiogroup"
                    :aria-label="$t('climbing.color')"
                >
                    <button
                        v-for="c in activePalette"
                        :key="c"
                        type="button"
                        role="radio"
                        class="color-swatch"
                        :class="{ 'color-swatch--active': isCurrentColor(c) }"
                        :aria-checked="isCurrentColor(c)"
                        :aria-label="c"
                        :style="{ backgroundColor: c }"
                        @click="form.color = c"
                    />
                    <UPopover :content="{ side: 'top', align: 'end' }">
                        <button
                            type="button"
                            class="color-swatch color-swatch--custom"
                            :class="{
                                'color-swatch--active': isCustomColor,
                            }"
                            :style="
                                isCustomColor
                                    ? { background: form.color }
                                    : undefined
                            "
                            :aria-label="$t('climbing.customColor')"
                            data-testid="route-form-color-custom"
                        >
                            <UIcon
                                name="i-lucide-pipette"
                                class="size-5"
                                :class="{
                                    'text-white drop-shadow': !isCustomColor,
                                }"
                                :style="
                                    isCustomColor
                                        ? { color: readableTextOn(form.color) }
                                        : undefined
                                "
                            />
                        </button>
                        <template #content>
                            <div class="flex w-60 flex-col gap-3 p-3">
                                <UColorPicker
                                    v-model="form.color"
                                    class="mx-auto"
                                />
                                <UInput
                                    v-model="form.color"
                                    :aria-label="$t('climbing.customColor')"
                                    class="w-full font-mono"
                                    data-testid="route-form-color-hex"
                                >
                                    <template #leading>
                                        <span
                                            class="size-4 rounded-full ring ring-default"
                                            :style="{
                                                backgroundColor: form.color,
                                            }"
                                        />
                                    </template>
                                </UInput>
                            </div>
                        </template>
                    </UPopover>
                </div>
            </UFormField>
        </UForm>
        <template #actions>
            <UButton
                v-if="isEditMode"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                data-testid="route-form-delete"
                @click="deleteDialog = true"
            >
                {{ $t('actions.delete') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="route-form-cancel"
                @click="close"
                >{{ $t('actions.cancel') }}</UButton
            >
            <UButton
                color="primary"
                :loading="saving"
                data-testid="route-form-submit"
                @click="submit"
            >
                {{ isEditMode ? $t('actions.save') : $t('actions.create') }}
            </UButton>
        </template>
    </LayoutDialogShell>

    <ConfirmDialog
        v-model="deleteDialog"
        :title="$t('actions.confirm')"
        :message="$t('notifications.deleteItem')"
        :loading="deleting"
        @confirm="deleteRoute"
    />
</template>

<script setup lang="ts">
import type PocketBase from 'pocketbase'
import type { Form } from '@nuxt/ui'
import type { RouteRecord, WallRecord } from '~/types/models'
import {
    freePosition,
    insertByAnchor,
    isDescendingRange,
    wallForAnchor,
} from '#shared/utils/mapGeometry'
import {
    normalizeCreators,
    formatDateToYYYYMMDD,
} from '#shared/utils/formatting'
import { required, maxLength, type Rule } from '~/utils/validation'
import { ROUTE_TYPES } from '~/utils/routes'
import {
    gradeIndex,
    gradeLabels,
    isGradeSystem,
    type GradeSystem,
} from '#shared/utils/grades'

const { t } = useI18n()
const { error: notifyError } = useNotification()
const pb = usePocketbase() as PocketBase
const gymId = useCurrentGymId()

const fallbackColors = [
    '#F44336',
    '#FF9800',
    '#FFC107',
    '#4CAF50',
    '#009688',
    '#2196F3',
    '#673AB7',
    '#E91E63',
    '#FF5722',
    '#8BC34A',
    '#00BCD4',
    '#795548',
    '#FFFFFF',
    '#9E9E9E',
    '#212121',
    '#F8BBD0',
    '#B3E5FC',
    '#C8E6C9',
]

const usedColorsList = ref<string[]>([])
const defaultPalette = ref<string[]>([])

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
    ]
}

function colorDistance(a: string, b: string): number {
    const [r1, g1, b1] = hexToRgb(a)
    const [r2, g2, b2] = hexToRgb(b)
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

const colorModified = ref(false)

const similarColors = computed(() => {
    if (!usedColorsList.value.length || !form.color) return []
    const current = form.color.toUpperCase()
    return [...usedColorsList.value]
        .filter((c) => c.toUpperCase() !== current)
        .sort((a, b) => colorDistance(current, a) - colorDistance(current, b))
        .slice(0, 12)
})

const isCurrentColor = (color: string) =>
    form.color?.toUpperCase() === color.toUpperCase()

const activePalette = computed(() =>
    colorModified.value && similarColors.value.length
        ? similarColors.value
        : defaultPalette.value,
)

const isCustomColor = computed(
    () => !!form.color && !activePalette.value.some(isCurrentColor),
)

async function fetchUsedColors() {
    try {
        const records = await pb
            .collection('usedColors')
            .getFullList<{ color: string }>({
                fields: 'color',
                filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
            })
        usedColorsList.value = records.map((r) => r.color).filter(Boolean)
    } catch {
        usedColorsList.value = []
    }
}

function buildDefaultPalette() {
    const pool = usedColorsList.value.length
        ? usedColorsList.value
        : fallbackColors
    defaultPalette.value = [...pool]
        .sort(() => Math.random() - 0.5)
        .slice(0, 12)
}

const dialogOpen = ref(false)
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const formRef = ref<Form<typeof form> | null>(null)
const setterItems = ref<string[]>([])
const editRouteId = ref<string | null>(null)
const originalAnchorPointIsZero = ref(false)
const originalGrading = ref<{ type: string; system: GradeSystem } | null>(null)
const { gradeSystemFor } = useGradeSystems()

const form = reactive({
    name: '',
    grade: null as string | null,
    anchor_point: null as number | null,
    location: '',
    type: '',
    comment: '',
    creator: [] as string[],
    screw_date: '',
    color: '#FF5722',
    archived: false,
    wall: '' as string | null,
})
const originalWall = ref({ wall: '', position: null as number | null })
const locationWalls = ref<WallRecord[]>([])

const openSnapshot = ref('')
const hasChanges = computed(
    () => dialogOpen.value && JSON.stringify(form) !== openSnapshot.value,
)

const isEditMode = computed(() => editRouteId.value !== null)
const isBoulderRoute = computed(() => form.type === 'Boulder')
const savedAnchorPoint = computed(() =>
    isBoulderRoute.value ? 0 : form.anchor_point,
)

const { data: locationRecords } = useLocations()

const wallItems = computed(() =>
    locationWalls.value.map((wall) => ({ title: wall.name, value: wall.id })),
)

async function loadWalls(locationId: string) {
    locationWalls.value = locationId
        ? await pb
              .collection('walls')
              .getFullList<WallRecord>({
                  filter: pb.filter('location = {:locationId}', { locationId }),
                  sort: 'sort,name',
                  requestKey: 'routeFormWalls',
              })
              .catch(() => [])
        : []
}

watch(
    () => form.location,
    (next, previous) => {
        if (previous && next !== previous) form.wall = ''
        void loadWalls(next)
    },
    { flush: 'sync' },
)

let autoWall = ''
watch([savedAnchorPoint, locationWalls], ([anchor, walls]) => {
    if (isEditMode.value || (form.wall && form.wall !== autoWall)) return
    autoWall = wallForAnchor(walls, anchor) ?? ''
    form.wall = autoWall
})

async function wallPosition(wallId: string | null) {
    if (!wallId) return null
    if (wallId === originalWall.value.wall) return originalWall.value.position
    const neighbours = await pb.collection('routes').getFullList<RouteRecord>({
        filter: pb.filter('wall = {:wallId} && archived = false', {
            wallId,
        }),
        fields: 'id,anchor_point,wall_position',
        requestKey: null,
    })
    const anchor = Number(savedAnchorPoint.value)
    if (!(anchor > 0))
        return freePosition(
            neighbours.map((route) => route.wall_position ?? 0.5),
        )
    const wall = locationWalls.value.find((record) => record.id === wallId)
    return (
        insertByAnchor(
            neighbours,
            [{ id: '', anchor_point: anchor }],
            !!wall && isDescendingRange(wall),
        ).get('') ?? null
    )
}

const typeItems = computed(() =>
    ROUTE_TYPES.map((value): { title: string; value: string } => ({
        title: t(`routes.types.${value.toLowerCase()}`),
        value,
    })),
)

const requiredRule = required(t)

const nameRules = [required(t), maxLength(t, 30)]

const isAnchorPointValid = (value: number | null) => {
    if (value === null || value === undefined || String(value) === '')
        return false
    const n = Number(value)
    if (!Number.isInteger(n)) return false
    if (n === 0) return isBoulderRoute.value || originalAnchorPointIsZero.value
    return n >= 1 && n <= 100
}

const anchorPointRules: Rule[] = [
    (v) =>
        (v !== null && v !== undefined && String(v) !== '') ||
        t('validation.required'),
    (v) =>
        isAnchorPointValid(v as number | null) ||
        t('validation.anchorPointRange'),
]

const creatorRule: Rule = (v) =>
    (Array.isArray(v) && v.length > 0) || t('validation.required')

const validateForm = (state: Partial<typeof form>) =>
    validateRules(state, {
        name: nameRules,
        grade: [requiredRule],
        type: [requiredRule],
        anchor_point: isBoulderRoute.value ? [] : anchorPointRules,
        location: [requiredRule],
        creator: [creatorRule],
        screw_date: [requiredRule],
    })

function addCreator(name: string) {
    const trimmed = name.trim()
    if (!trimmed || form.creator.includes(trimmed)) return
    form.creator = [...form.creator, trimmed]
    if (!setterItems.value.includes(trimmed))
        setterItems.value = [...setterItems.value, trimmed]
}

const gradeSystem = computed(() =>
    originalGrading.value && originalGrading.value.type === form.type
        ? originalGrading.value.system
        : gradeSystemFor(form.type),
)

const gradeFieldLabel = computed(
    () =>
        `${t('climbing.difficulty')} (${t(`gradeSystems.${gradeSystem.value}`)})`,
)

watch(gradeSystem, (system) => {
    if (form.grade && !gradeLabels(system).includes(form.grade))
        form.grade = null
})

const resetForm = () => {
    form.name = ''
    form.grade = null
    form.anchor_point = null
    form.location = ''
    form.type = ''
    form.comment = ''
    form.creator = []
    form.screw_date = ''
    form.color = '#FF5722'
    form.archived = false
    form.wall = ''
    autoWall = ''
    originalWall.value = { wall: '', position: null }
    editRouteId.value = null
    originalAnchorPointIsZero.value = false
    originalGrading.value = null
}

const loadFromRoute = (route: RouteRecord) => {
    editRouteId.value = route.id
    originalAnchorPointIsZero.value = Number(route.anchor_point) === 0

    form.name = route.name ?? ''
    form.grade = route.grade || null
    originalGrading.value = isGradeSystem(route.grade_system)
        ? { type: route.type ?? '', system: route.grade_system }
        : null
    form.anchor_point = route.anchor_point ?? null
    form.location = route.location ?? ''
    form.type = route.type ?? ''
    form.comment = route.comment ?? ''
    form.creator = normalizeCreators(route.creator)
    form.screw_date = formatDateToYYYYMMDD(route.screw_date ?? null)
    form.color = route.color ?? '#FF5722'
    form.archived = route.archived ?? false
    form.wall = route.wall ?? ''
    originalWall.value = {
        wall: route.wall ?? '',
        position: route.wall_position ?? null,
    }
}

const getSetters = async () => {
    try {
        const records = await pb
            .collection('routes')
            .getFullList<RouteRecord>({ fields: 'creator', sort: '-created' })
        const creators = records.flatMap((r) => normalizeCreators(r.creator))
        setterItems.value = Array.from(new Set(creators.filter(Boolean)))
    } catch (error) {
        console.error('Failed to fetch route setters:', error)
    }
}

async function open(route?: RouteRecord) {
    resetForm()
    colorModified.value = false
    if (route) {
        loadFromRoute(route)
    }
    openSnapshot.value = JSON.stringify(form)
    dialogOpen.value = true
    void getSetters()
    await fetchUsedColors()
    buildDefaultPalette()
    await nextTick()
    colorModified.value = false
    openSnapshot.value = JSON.stringify(form)
}

function close() {
    dialogOpen.value = false
}

const emit = defineEmits<{
    saved: [payload: Partial<RouteRecord>]
    closed: []
    deleted: [id: string]
}>()

watch(dialogOpen, (val) => {
    if (!val) emit('closed')
})

watch(
    () => form.color,
    () => {
        if (dialogOpen.value) colorModified.value = true
    },
)

async function submit() {
    if (!formRef.value) return
    const valid = (await formRef.value.validate({ silent: true })) !== false
    if (!valid) return

    saving.value = true
    try {
        const payload: Partial<RouteRecord> = {
            name: form.name,
            grade: form.grade ?? '',
            grade_system: gradeSystem.value,
            grade_index: gradeIndex(gradeSystem.value, form.grade),
            anchor_point: savedAnchorPoint.value,
            location: form.location,
            type: form.type,
            comment: form.comment || '',
            creator: [...form.creator],
            screw_date: form.screw_date,
            color: form.color,
            archived: isEditMode.value ? Boolean(form.archived) : false,
            wall: form.wall || '',
            wall_position: await wallPosition(form.wall || null),
        }

        if (isEditMode.value && editRouteId.value) {
            await pb.collection('routes').update(editRouteId.value, payload)
        } else {
            await pb.collection('routes').create(payload)
        }

        const savedId = isEditMode.value ? editRouteId.value : undefined
        close()
        emit('saved', savedId ? { ...payload, id: savedId } : payload)
    } catch (error) {
        console.error('Failed to save route:', error)
        notifyError(t('notifications.error.generic'))
    } finally {
        saving.value = false
    }
}

async function deleteRoute() {
    if (!editRouteId.value) return
    deleting.value = true
    try {
        await pb.collection('routes').delete(editRouteId.value)
        const id = editRouteId.value
        deleteDialog.value = false
        close()
        emit('deleted', id)
    } catch (error) {
        console.error('Failed to delete route:', error)
        notifyError(t('notifications.error.generic'))
    } finally {
        deleting.value = false
    }
}

defineExpose({ open })
</script>

<style scoped>
.color-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 18%, transparent);
    transition:
        box-shadow 0.15s,
        transform 0.15s;
}

.color-swatch:hover {
    transform: scale(1.08);
}

.color-swatch--active {
    box-shadow:
        0 0 0 2px var(--ui-bg),
        0 0 0 4px var(--ui-primary);
}

.color-swatch--custom {
    background: conic-gradient(
        from 90deg,
        #f44336,
        #ffeb3b,
        #4caf50,
        #03a9f4,
        #9c27b0,
        #f44336
    );
}
</style>
