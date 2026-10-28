<template>
    <LayoutDialogShell
        v-model="dialogOpen"
        max-width="560"
        closable
        sheet-on-mobile
        :title="isEditMode ? $t('actions.edit') : $t('climbing.create')"
        :persistent="hasChanges"
        data-testid="route-form-dialog"
        :submit-label="isEditMode ? $t('actions.save') : $t('actions.create')"
        :submit-loading="saving"
        submit-test-id="route-form-submit"
        cancel-test-id="route-form-cancel"
        @submit="submit"
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
                :hint="`${form.name.length}/${NAME_MAX}`"
            >
                <UInput
                    v-model="form.name"
                    :maxlength="NAME_MAX"
                    class="w-full"
                    data-testid="route-form-name"
                >
                    <template #trailing>
                        <UButton
                            icon="i-lucide-dices"
                            color="neutral"
                            variant="link"
                            size="sm"
                            class="icon-btn"
                            :aria-label="$t('routes.generate_name')"
                            data-testid="route-form-generate-name"
                            @click="generateName"
                        />
                    </template>
                </UInput>
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

            <UFormField :label="$t('routes.screwed_at')" name="screw_date">
                <UInput
                    v-model="form.screw_date"
                    type="date"
                    class="w-full sm:w-1/2"
                    data-testid="route-form-screw-date"
                />
            </UFormField>

            <LayoutListGroup>
                <li v-for="flag in routeFlags" :key="flag.key">
                    <label
                        class="flex cursor-pointer items-center gap-3 px-4 py-3"
                    >
                        <UIcon
                            :name="flag.icon"
                            class="size-5 shrink-0 text-muted"
                        />
                        <span class="min-w-0 grow">
                            <span class="block text-sm font-medium">
                                {{ $t(`climbing.${flag.key}`) }}
                            </span>
                            <span class="block text-xs text-muted">
                                {{ $t(`climbing.${flag.key}Help`) }}
                            </span>
                        </span>
                        <USwitch
                            v-model="form[flag.key]"
                            :data-testid="`route-form-${flag.key}`"
                        />
                    </label>
                </li>
            </LayoutListGroup>

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

            <UFormField :label="$t('climbing.color')" name="color">
                <ColorSwatchPicker
                    v-model="form.color"
                    :swatches="activePalette"
                    :label="$t('climbing.color')"
                    test-id-prefix="route-form"
                />
            </UFormField>
        </UForm>
        <template #footer-start>
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
        </template>
    </LayoutDialogShell>

    <ConfirmDialog
        v-model="deleteDialog"
        :title="$t('actions.confirm')"
        :message="
            forceDelete
                ? $t('notifications.deleteRouteWithHistory')
                : $t('notifications.deleteItem')
        "
        :loading="deleting"
        @confirm="deleteRoute"
    />
</template>

<script setup lang="ts">
import { ROUTE_TYPES } from '#shared/utils/routeTypes'
import {
    createRoute,
    deleteRoute as deleteRouteRecord,
    listRouteColors,
    listRoutes,
    updateRoute,
    type RouteInput,
} from '~/api/routes'
import type { Form } from '@nuxt/ui'
import type { RouteRecord } from '~/types/models'
import {
    freePosition,
    insertByAnchor,
    isDescendingRange,
    wallForAnchor,
} from '#shared/utils/mapGeometry'
import { normalizeCreators, localDateYYYYMMDD } from '#shared/utils/formatting'
import { required, maxLength, type Rule } from '~/utils/validation'
import {
    SETTER_SUGGESTION_ROUTES,
    changedFields,
    setterNames,
} from '~/utils/routes'
import {
    gradeIndex,
    gradeLabels,
    isGradeSystem,
    type GradeSystem,
} from '#shared/utils/grades'
import { generateRouteName } from '#shared/utils/routeNames'
import { nearestColors } from '~/utils/colorName'
import { formFieldErrors } from '~/utils/fieldErrors'

const { t, locale } = useI18n()
const { error: notifyError } = useNotification()
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

const colorModified = ref(false)

const similarColors = computed(() => {
    if (!usedColorsList.value.length || !form.color) return []
    return nearestColors(form.color, usedColorsList.value, 12)
})

const activePalette = computed(() =>
    colorModified.value && similarColors.value.length
        ? similarColors.value
        : defaultPalette.value,
)

async function fetchUsedColors() {
    try {
        usedColorsList.value = await listRouteColors(gymId.value)
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
const forceDelete = ref(false)
watch(deleteDialog, (open) => {
    if (!open) forceDelete.value = false
})
const formRef = ref<Form<typeof form> | null>(null)
const setterItems = ref<string[]>([])
const editRouteId = ref<string | null>(null)
const originalAnchorPointIsZero = ref(false)
const originalGrading = ref<{ type: string; system: GradeSystem } | null>(null)
const { gradeSystemFor } = useGradeSystems()
const routeFlags = computed(() => [
    { key: 'permanent' as const, icon: 'i-lucide-mountain' },
    ...(isEditMode.value
        ? [{ key: 'archived' as const, icon: 'i-lucide-archive' }]
        : []),
])

const form = reactive({
    name: '',
    grade: null as string | null,
    anchor_point: null as number | null,
    location: '',
    type: '' as RouteRecord['type'],
    comment: '',
    creator: [] as string[],
    screw_date: '',
    color: '#FF5722',
    archived: false,
    permanent: false,
    wall: '' as string | null,
})
const originalWall = ref({ wall: '', position: null as number | null })
const openPayload = ref<RouteInput | null>(null)

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

const locationWalls = useLocationWalls(gymId, () => form.location)

const wallItems = computed(() =>
    locationWalls.value.map((wall) => ({ title: wall.name, value: wall.id })),
)

watch(
    () => form.location,
    (next, previous) => {
        if (previous && next !== previous) form.wall = ''
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
    const { items: neighbours } = await listRoutes<RouteRecord>(gymId.value, {
        wall: wallId,
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
    ROUTE_TYPES.map((value): { title: string; value: RouteRecord['type'] } => ({
        title: t(`routes.types.${value.toLowerCase()}`),
        value,
    })),
)

const requiredRule = required(t)

const NAME_MAX = 100
const nameRules = [required(t), maxLength(t, NAME_MAX)]

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

function generateName() {
    form.name = generateRouteName(
        locale.value,
        (key) => t(`routeNames.${key}`),
        {
            type: form.type,
            gradeIndex: gradeIndex(gradeSystem.value, form.grade),
            color: form.color,
        },
        Math.random,
        form.name,
    )
}

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
    form.screw_date = localDateYYYYMMDD()
    form.color = '#FF5722'
    form.archived = false
    form.permanent = false
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
    form.screw_date = route.screw_date ?? ''
    form.color = route.color ?? '#FF5722'
    form.archived = route.archived ?? false
    form.permanent = route.permanent ?? false
    form.wall = route.wall ?? ''
    originalWall.value = {
        wall: route.wall ?? '',
        position: route.wall_position ?? null,
    }
}

const getSetters = async () => {
    if (!gymId.value) return
    try {
        const recent = await listRoutes<RouteRecord>(gymId.value, {
            archived: 'all',
            sort: '-created',
            page: 1,
            limit: SETTER_SUGGESTION_ROUTES,
        })
        setterItems.value = setterNames(recent.items)
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
    openPayload.value = route ? await buildPayload() : null
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
    saved: [payload: RouteInput & { id?: string }]
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

const FORM_FIELDS = [
    'name',
    'grade',
    'type',
    'anchor_point',
    'location',
    'wall',
    'creator',
    'screw_date',
    'comment',
    'color',
] as const

async function buildPayload(): Promise<RouteInput> {
    return {
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
        permanent: form.permanent,
        wall: form.wall || '',
        wall_position: await wallPosition(form.wall || null),
    }
}

async function submit() {
    if (!formRef.value || saving.value) return
    saving.value = true
    try {
        const valid = (await formRef.value.validate({ silent: true })) !== false
        if (!valid) return
        const payload = await buildPayload()

        if (isEditMode.value && editRouteId.value) {
            await updateRoute(
                editRouteId.value,
                openPayload.value
                    ? changedFields(payload, openPayload.value)
                    : payload,
            )
        } else {
            await createRoute(gymId.value, payload)
        }

        const savedId = isEditMode.value ? editRouteId.value : undefined
        close()
        emit('saved', savedId ? { ...payload, id: savedId } : payload)
    } catch (error) {
        const fieldErrors = formFieldErrors(error, FORM_FIELDS, t)
        if (fieldErrors.length) formRef.value?.setErrors(fieldErrors)
        else notifyError(t('notifications.error.generic'))
    } finally {
        saving.value = false
    }
}

async function deleteRoute() {
    if (!editRouteId.value) return
    deleting.value = true
    try {
        await deleteRouteRecord(editRouteId.value, forceDelete.value)
        const id = editRouteId.value
        deleteDialog.value = false
        close()
        emit('deleted', id)
    } catch (error) {
        if ((error as { status?: number })?.status === 409) {
            forceDelete.value = true
            return
        }
        console.error('Failed to delete route:', error)
        notifyError(t('notifications.error.generic'))
    } finally {
        deleting.value = false
    }
}

defineExpose({ open })
</script>
