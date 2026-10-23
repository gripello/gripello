<template>
    <LayoutDialogShell
        v-model="open"
        max-width="640"
        closable
        scrollable
        sheet-on-mobile
        data-testid="task-form-dialog"
        :submit-label="$t('actions.save')"
        submit-icon="i-lucide-check"
        :submit-loading="pending"
        submit-test-id="task-form-save"
        cancel-test-id="task-form-cancel"
        @submit="save"
    >
        <template #title>
            <div class="flex min-w-0 items-center gap-3">
                <div
                    class="flex size-10 shrink-0 items-center justify-center rounded-xl"
                    :class="
                        form.priority === URGENT_TASK_PRIORITY
                            ? 'bg-error/10 text-error'
                            : 'bg-primary/10 text-primary'
                    "
                >
                    <UIcon :name="headerIcon" class="size-5" />
                </div>
                <div class="min-w-0">
                    <p
                        class="truncate text-base font-semibold text-highlighted"
                    >
                        {{ headerTitle }}
                    </p>
                    <p
                        v-if="headerSubtitle"
                        class="truncate text-xs font-normal text-muted"
                    >
                        {{ headerSubtitle }}
                    </p>
                </div>
            </div>
        </template>

        <UForm
            ref="formRef"
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            class="flex flex-col gap-5"
            @submit.prevent
        >
            <UFormField v-if="task" :label="$t('tasks.status')">
                <OptionGrid
                    v-model="form.status"
                    :items="statusItems"
                    cols="grid-cols-2 sm:grid-cols-5"
                    :label="$t('tasks.status')"
                    test-id-prefix="task-form-status"
                />
            </UFormField>

            <USeparator :label="$t('tasks.sections.task')" />

            <UFormField
                v-if="!task"
                :label="$t('tasks.kind')"
                data-testid="task-form-kind"
            >
                <OptionGrid
                    v-model="form.kind"
                    :items="kindItems"
                    cols="grid-cols-3"
                    :label="$t('tasks.kind')"
                    test-id-prefix="task-form-kind"
                />
            </UFormField>

            <UFormField
                v-if="!isDefect"
                :label="$t('tasks.title')"
                name="title"
            >
                <UInput
                    v-model="form.title"
                    size="lg"
                    :placeholder="$t('tasks.titlePlaceholder')"
                    class="w-full"
                    data-testid="task-form-title"
                />
            </UFormField>
            <UFormField v-else :label="$t('tasks.category')" name="category">
                <USelectMenu
                    v-model="form.category"
                    :items="categoryItems"
                    value-key="value"
                    :icon="DEFECT_CATEGORY_ICONS[form.category]"
                    :search-input="false"
                    class="w-full"
                    data-testid="task-form-category"
                />
            </UFormField>

            <UFormField :label="$t('tasks.priority')">
                <OptionGrid
                    v-model="form.priority"
                    :items="priorityItems"
                    cols="grid-cols-2 sm:grid-cols-4"
                    :label="$t('tasks.priority')"
                    test-id-prefix="task-form-priority"
                />
            </UFormField>

            <UFormField :label="$t('tasks.description')" name="description">
                <UTextarea
                    v-model="form.description"
                    :rows="3"
                    :maxlength="2000"
                    autoresize
                    :placeholder="$t('tasks.descriptionPlaceholder')"
                    class="w-full"
                    data-testid="task-form-description"
                />
            </UFormField>

            <USeparator :label="$t('tasks.sections.place')" />

            <div
                v-if="targetRoute"
                class="flex items-center gap-3 rounded-lg bg-elevated/50 p-3 ring ring-default"
                data-testid="task-form-route"
            >
                <RouteSummary
                    :route="targetRoute"
                    :meta="targetWallName"
                    class="flex-1"
                />
                <UButton
                    :to="gymPath(`/route?id=${targetRoute.id}`)"
                    icon="i-lucide-external-link"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="icon-btn"
                    :aria-label="$t('tasks.openRoute')"
                />
            </div>
            <p
                v-else-if="targetRouteId"
                class="flex items-center gap-2 text-sm text-muted"
            >
                <UIcon name="i-lucide-route" class="size-4" />
                {{ $t('tasks.forThisRoute') }}
            </p>
            <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <UFormField :label="$t('tasks.location')" name="location">
                    <USelect
                        v-model="form.location"
                        :items="locationItems"
                        icon="i-lucide-map-pin"
                        class="w-full"
                        data-testid="task-form-location"
                    />
                </UFormField>
                <UFormField :label="$t('tasks.wall')" name="wall">
                    <USelectMenu
                        v-model="form.wall"
                        :items="wallItems"
                        value-key="value"
                        icon="i-lucide-brick-wall"
                        :search-input="{ placeholder: $t('actions.search') }"
                        :disabled="!wallItems.length"
                        clear
                        class="w-full"
                        data-testid="task-form-wall"
                    />
                </UFormField>
            </div>

            <USeparator :label="$t('tasks.sections.assignment')" />

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <UFormField :label="$t('tasks.assignee')" name="assignee">
                    <template #hint>
                        <UButton
                            v-if="
                                myAssigneeId && form.assignee !== myAssigneeId
                            "
                            variant="link"
                            size="xs"
                            class="p-0"
                            data-testid="task-form-assign-me"
                            @click="form.assignee = myAssigneeId"
                        >
                            {{ $t('tasks.assignToMe') }}
                        </UButton>
                    </template>
                    <USelectMenu
                        v-model="form.assignee"
                        :items="assigneeItems"
                        value-key="value"
                        :avatar="selectedAssigneeAvatar"
                        icon="i-lucide-user"
                        :placeholder="$t('tasks.unassigned')"
                        clear
                        class="w-full"
                        data-testid="task-form-assignee"
                    />
                </UFormField>
                <UFormField :label="$t('tasks.dueDate')" name="dueDate">
                    <UInput
                        v-model="form.dueDate"
                        type="date"
                        icon="i-lucide-calendar"
                        class="w-full"
                        data-testid="task-form-due"
                    />
                </UFormField>
            </div>

            <template v-if="task">
                <USeparator :label="$t('tasks.sections.resolution')" />
                <UFormField
                    :label="$t('tasks.resolutionNote')"
                    name="resolutionNote"
                >
                    <UTextarea
                        v-model="form.resolutionNote"
                        :rows="2"
                        :maxlength="1000"
                        autoresize
                        :placeholder="$t('tasks.resolutionPlaceholder')"
                        class="w-full"
                        data-testid="task-form-resolution"
                    />
                </UFormField>
            </template>

            <UFormField :label="$t('tasks.photo')">
                <LayoutImageViewer
                    v-if="existingPhotoUrl && !photo"
                    :src="existingPhotoUrl"
                    :alt="$t('tasks.photo')"
                    class="block w-full overflow-hidden rounded-lg ring ring-default"
                    @click="renewFileToken"
                >
                    <img
                        :src="existingThumbUrl"
                        :srcset="
                            thumbSrcset(existingThumbUrl, THUMB_SETS.photo)
                        "
                        sizes="(min-width: 640px) 640px, 100vw"
                        :alt="$t('tasks.photo')"
                        class="max-h-56 w-full object-cover"
                        data-testid="task-form-photo-preview"
                        @error="renewFileToken"
                    />
                </LayoutImageViewer>
                <UFileUpload
                    v-else
                    v-model="photo"
                    accept="image/jpeg,image/png,image/webp"
                    :label="$t('tasks.photoAdd')"
                    :description="$t('tasks.photoHint')"
                    icon="i-lucide-camera"
                    class="min-h-28 w-full"
                    data-testid="task-form-photo"
                />
            </UFormField>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { THUMBS, THUMB_SETS, thumbSrcset } from '#shared/utils/thumbs'
import {
    DEFECT_CATEGORIES,
    STAFF_TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUSES,
} from '#shared/utils/tasks'
import { listWalls } from '~/api/routes'
import {
    createTask,
    listTaskAssignees,
    updateTask,
    type TaskInput,
} from '~/api/tasks'
import { fileUrl } from '~/api/client'
import { formFieldErrors } from '~/utils/fieldErrors'
import { changedFields } from '~/utils/routes'
import { maxLength, nonBlank, validateRules } from '~/utils/validation'
import {
    DEFECT_CATEGORY_ICONS,
    NORMAL_TASK_PRIORITY,
    TASK_STATUS_ICONS,
    taskPriorityColor,
    taskPriorityLevel,
    taskStatusColor,
    taskTitle,
    URGENT_TASK_PRIORITY,
} from '~/utils/tasks'
import { timeAgo } from '#shared/utils/formatting'
import type {
    DefectCategory,
    RouteRecord,
    TaskAssigneeRecord,
    TaskKind,
    TaskRecord,
    TaskStatus,
    WallRecord,
} from '~/types/models'

const gymPath = useGymPath()

const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const KIND_ICONS = {
    wish: 'i-lucide-sparkles',
    reset: 'i-lucide-refresh-cw',
    maintenance: 'i-lucide-wrench',
    other: 'i-lucide-list-todo',
} as const

const PRIORITY_ICONS = {
    low: 'i-lucide-arrow-down',
    normal: 'i-lucide-minus',
    high: 'i-lucide-arrow-up',
    urgent: 'i-lucide-siren',
} as const

const props = defineProps<{
    task?: TaskRecord | null
    routeId?: string | null
}>()

const emit = defineEmits<{ saved: [task: TaskRecord] }>()

const open = defineModel<boolean>({ default: false })

const authStore = useAuthStore()
const gymId = useCurrentGymId()
const { t, locale } = useI18n()

const statusItems = computed(() =>
    TASK_STATUSES.map((status) => ({
        value: status,
        label: t(`tasks.statuses.${status}`),
        icon: TASK_STATUS_ICONS[status],
        color: taskStatusColor(status),
    })),
)

const kindItems = computed(() =>
    STAFF_TASK_KINDS.map((kind) => ({
        value: kind,
        label: t(`tasks.kinds.${kind}`),
        icon: KIND_ICONS[kind],
    })),
)

const priorityItems = computed(() =>
    TASK_PRIORITIES.map((name) => ({
        value: taskPriorityLevel(name),
        id: name,
        label: t(`tasks.priorities.${name}`),
        icon: PRIORITY_ICONS[name],
        color: taskPriorityColor(taskPriorityLevel(name)),
    })),
)
const { warning } = useNotification()
const { pending, run } = useAsyncAction()
const { data: locationRecords, items: locationItems } = useLocations()

const formRef = ref<{
    validate: (opts: { silent: boolean }) => Promise<unknown>
    setErrors: (errors: { name: string; message: string }[]) => void
}>()
const walls = ref<WallRecord[]>([])
const assignees = ref<TaskAssigneeRecord[]>([])
const photo = ref<File | null>(null)
let openedInput: TaskInput = {}

const form = reactive({
    title: '',
    kind: 'maintenance' as TaskKind,
    category: 'other' as DefectCategory,
    priority: NORMAL_TASK_PRIORITY,
    status: 'open' as TaskStatus,
    location: '',
    wall: undefined as string | undefined,
    assignee: undefined as string | undefined,
    dueDate: '',
    description: '',
    resolutionNote: '',
})

const isDefect = computed(() => form.kind === 'defect')
const targetRouteId = computed(() => props.task?.route || props.routeId || '')

const formRules = computed(() => ({
    title:
        isDefect.value || form.kind === 'wish'
            ? [maxLength(t, 200)]
            : [nonBlank(t), maxLength(t, 200)],
    description: [maxLength(t, 2000)],
    resolutionNote: [maxLength(t, 1000)],
}))

const categoryItems = computed(() =>
    DEFECT_CATEGORIES.map((value) => ({
        value,
        label: t(`tasks.categories.${value}`),
        icon: DEFECT_CATEGORY_ICONS[value],
    })),
)
const wallItems = computed(() =>
    walls.value
        .filter((wall) => wall.location === form.location)
        .map((wall) => ({ value: wall.id, label: wall.name })),
)
const assigneeItems = computed(() =>
    assignees.value.map((assignee) => ({
        value: assignee.user,
        label: assignee.name,
        avatar: { alt: assignee.name },
    })),
)
const selectedAssigneeAvatar = computed(
    () =>
        assigneeItems.value.find((item) => item.value === form.assignee)
            ?.avatar,
)
const myAssigneeId = computed(() =>
    assignees.value.some((item) => item.user === authStore.record?.id)
        ? authStore.record?.id
        : undefined,
)

const targetRoute = computed(
    () => props.task?.expand?.route as RouteRecord | undefined,
)
const targetWallName = computed(
    () => (props.task?.expand?.wall as WallRecord | undefined)?.name,
)
const headerIcon = computed(() =>
    isDefect.value
        ? DEFECT_CATEGORY_ICONS[form.category]
        : KIND_ICONS[form.kind as keyof typeof KIND_ICONS],
)
const headerTitle = computed(() =>
    props.task ? taskTitle(props.task, t) : t('tasks.newTitle'),
)
const headerSubtitle = computed(() =>
    props.task
        ? [
              targetRoute.value?.name,
              timeAgo(props.task.created, t, locale.value),
          ]
              .filter(Boolean)
              .join(' · ')
        : t('tasks.newSubtitle'),
)

const { token: fileToken, renew: renewFileToken } = useFileToken(() =>
    props.task?.photo ? { table: 'tasks', id: props.task.id } : null,
)
const existingPhotoUrl = computed(() =>
    fileToken.value
        ? fileUrl('tasks', props.task, props.task?.photo, {
              token: fileToken.value,
          })
        : '',
)
const existingThumbUrl = computed(() =>
    fileToken.value
        ? fileUrl('tasks', props.task, props.task?.photo, {
              token: fileToken.value,
              thumb: THUMBS.photo,
          })
        : '',
)

watch(
    () => form.location,
    () => {
        if (
            walls.value.length &&
            !wallItems.value.some((item) => item.value === form.wall)
        )
            form.wall = undefined
    },
)

watch(open, async (isOpen) => {
    if (!isOpen) return
    const task = props.task
    Object.assign(form, {
        title: task?.title ?? '',
        kind: task?.kind ?? 'maintenance',
        category: task?.category || 'other',
        priority: task?.priority ?? NORMAL_TASK_PRIORITY,
        status: task?.status ?? 'open',
        location: task?.location || locationRecords.value[0]?.id || '',
        wall: task?.wall || undefined,
        assignee: task?.assignee || undefined,
        dueDate: task?.due_date ?? '',
        description: task?.description ?? '',
        resolutionNote: task?.resolution_note ?? '',
    })
    openedInput = buildInput()
    photo.value = null
    const [loadedAssignees, loadedWalls] = await Promise.all([
        listTaskAssignees(gymId.value).catch(() => []),
        walls.value.length || targetRouteId.value
            ? walls.value
            : listWalls(gymId.value).catch(() => []),
    ])
    assignees.value = loadedAssignees
    walls.value = loadedWalls
})

function buildInput(): TaskInput {
    return {
        ...(isDefect.value
            ? { category: form.category }
            : { title: form.title.trim() }),
        priority: form.priority,
        ...(targetRouteId.value
            ? { route: targetRouteId.value }
            : { location: form.location, wall: form.wall ?? '' }),
        assignee: form.assignee ?? '',
        due_date: form.dueDate,
        description: form.description.trim(),
        ...(props.task
            ? {
                  status: form.status,
                  resolution_note: form.resolutionNote.trim(),
              }
            : {}),
    }
}

const API_FORM_FIELDS: Record<string, string> = {
    title: 'title',
    category: 'category',
    description: 'description',
    location: 'location',
    wall: 'wall',
    assignee: 'assignee',
    due_date: 'dueDate',
    resolution_note: 'resolutionNote',
}

function showFieldErrors(error: unknown) {
    const errors = formFieldErrors(error, Object.keys(API_FORM_FIELDS), t).map(
        ({ name, message }) => ({ name: API_FORM_FIELDS[name]!, message }),
    )
    if (errors.length) formRef.value?.setErrors(errors)
    return errors.length > 0
}

async function save() {
    if (pending.value) return
    pending.value = true
    const valid = (await formRef.value?.validate({ silent: true })) !== false
    pending.value = false
    if (!valid) return
    if (photo.value && photo.value.size > MAX_PHOTO_BYTES) {
        warning(t('tasks.photoTooLarge'))
        return
    }
    await run(
        async () => {
            const saved = props.task
                ? await updateTask(
                      props.task.id,
                      changedFields(buildInput(), openedInput),
                      photo.value,
                  )
                : await createTask(
                      gymId.value,
                      { kind: form.kind, ...buildInput() },
                      photo.value,
                  )
            emit('saved', saved)
            open.value = false
        },
        { success: t('tasks.saved'), handled: showFieldErrors },
    )
}
</script>
