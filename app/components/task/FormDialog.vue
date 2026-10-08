<template>
    <LayoutDialogShell
        v-model="open"
        max-width="640"
        closable
        scrollable
        sheet-on-mobile
        data-testid="task-form-dialog"
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
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <UButton
                        v-for="status in TASK_STATUSES"
                        :key="status"
                        :icon="TASK_STATUS_ICONS[status]"
                        :color="
                            form.status === status
                                ? taskStatusColor(status)
                                : 'neutral'
                        "
                        :variant="form.status === status ? 'soft' : 'outline'"
                        :aria-pressed="form.status === status"
                        size="sm"
                        class="justify-center"
                        :data-testid="`task-form-status-${status}`"
                        @click="form.status = status"
                    >
                        {{ $t(`tasks.statuses.${status}`) }}
                    </UButton>
                </div>
            </UFormField>

            <USeparator :label="$t('tasks.sections.task')" />

            <UFormField
                v-if="!task"
                :label="$t('tasks.kind')"
                data-testid="task-form-kind"
            >
                <div class="grid grid-cols-3 gap-2">
                    <UButton
                        v-for="kind in STAFF_TASK_KINDS"
                        :key="kind"
                        :icon="KIND_ICONS[kind]"
                        :color="form.kind === kind ? 'primary' : 'neutral'"
                        :variant="form.kind === kind ? 'soft' : 'outline'"
                        :aria-pressed="form.kind === kind"
                        size="sm"
                        class="justify-center"
                        :data-testid="`task-form-kind-${kind}`"
                        @click="form.kind = kind"
                    >
                        {{ $t(`tasks.kinds.${kind}`) }}
                    </UButton>
                </div>
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
            <UFormField v-else :label="$t('tasks.category')">
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
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <UButton
                        v-for="name in TASK_PRIORITIES"
                        :key="name"
                        :icon="PRIORITY_ICONS[name]"
                        :color="
                            form.priority === taskPriorityLevel(name)
                                ? taskPriorityColor(taskPriorityLevel(name))
                                : 'neutral'
                        "
                        :variant="
                            form.priority === taskPriorityLevel(name)
                                ? 'soft'
                                : 'outline'
                        "
                        :aria-pressed="
                            form.priority === taskPriorityLevel(name)
                        "
                        size="sm"
                        class="justify-center"
                        :data-testid="`task-form-priority-${name}`"
                        @click="form.priority = taskPriorityLevel(name)"
                    >
                        {{ $t(`tasks.priorities.${name}`) }}
                    </UButton>
                </div>
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
                <UFormField :label="$t('tasks.location')">
                    <USelect
                        v-model="form.location"
                        :items="locationItems"
                        icon="i-lucide-map-pin"
                        class="w-full"
                        data-testid="task-form-location"
                    />
                </UFormField>
                <UFormField :label="$t('tasks.wall')">
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
                <UFormField :label="$t('tasks.assignee')">
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
                <UFormField :label="$t('tasks.dueDate')">
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
                <a
                    v-if="existingPhotoUrl && !photo"
                    :href="existingPhotoUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block overflow-hidden rounded-lg ring ring-default"
                >
                    <img
                        :src="existingThumbUrl"
                        :alt="$t('tasks.photo')"
                        class="max-h-56 w-full object-cover"
                        data-testid="task-form-photo-preview"
                    />
                </a>
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

        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="task-form-cancel"
                @click="open = false"
                >{{ $t('actions.cancel') }}</UButton
            >
            <div class="flex-1" />
            <UButton
                color="primary"
                icon="i-lucide-check"
                :loading="pending"
                data-testid="task-form-save"
                @click="save"
                >{{ $t('actions.save') }}</UButton
            >
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { maxLength, nonBlank, validateRules } from '~/utils/validation'
import {
    DEFECT_CATEGORIES,
    DEFECT_CATEGORY_ICONS,
    NORMAL_TASK_PRIORITY,
    STAFF_TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUS_ICONS,
    TASK_STATUSES,
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
    fileToken?: string
}>()

const emit = defineEmits<{ saved: [task: TaskRecord] }>()

const open = defineModel<boolean>({ default: false })

const pb = usePocketbase()
const gymId = useCurrentGymId()
const { t, locale } = useI18n()
const { warning } = useNotification()
const { pending, run } = useAsyncAction()
const { data: locationRecords } = useLocations()

const formRef = ref<{
    validate: (opts: { silent: boolean }) => Promise<unknown>
}>()
const walls = ref<WallRecord[]>([])
const assignees = ref<TaskAssigneeRecord[]>([])
const photo = ref<File | null>(null)

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
const locationItems = computed(() =>
    locationRecords.value.map((location) => ({
        value: location.id,
        label: location.name,
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
    assignees.value.some((item) => item.user === pb.authStore.record?.id)
        ? pb.authStore.record?.id
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

const fileQuery = computed(() =>
    props.fileToken ? { token: props.fileToken } : undefined,
)
const existingPhotoUrl = computed(() =>
    usePbFileUrl(props.task, props.task?.photo, fileQuery.value),
)
const existingThumbUrl = computed(() =>
    usePbFileUrl(props.task, props.task?.photo, {
        ...fileQuery.value,
        thumb: '400x0',
    }),
)

watch(
    () => form.location,
    () => {
        if (!wallItems.value.some((item) => item.value === form.wall))
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
        dueDate: task?.due_date?.slice(0, 10) ?? '',
        description: task?.description ?? '',
        resolutionNote: task?.resolution_note ?? '',
    })
    photo.value = null
    const [loadedAssignees, loadedWalls] = await Promise.all([
        pb
            .collection('task_assignees')
            .getFullList<TaskAssigneeRecord>({
                filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
                sort: 'name',
                requestKey: null,
            })
            .catch(() => []),
        walls.value.length || targetRouteId.value
            ? walls.value
            : pb
                  .collection('walls')
                  .getFullList<WallRecord>({
                      filter: gymFilter(pb, gymId.value),
                      sort: 'sort,name',
                      requestKey: null,
                  })
                  .catch(() => []),
    ])
    assignees.value = loadedAssignees
    walls.value = loadedWalls
})

function buildBody() {
    const body = new FormData()
    if (!props.task) {
        body.append('kind', form.kind)
        body.append('gym', gymId.value)
    }
    if (isDefect.value) body.append('category', form.category)
    else body.append('title', form.title.trim())
    body.append('priority', String(form.priority))
    if (targetRouteId.value) body.append('route', targetRouteId.value)
    else {
        body.append('location', form.location)
        body.append('wall', form.wall ?? '')
    }
    body.append('assignee', form.assignee ?? '')
    body.append('due_date', form.dueDate)
    body.append('description', form.description.trim())
    if (props.task) {
        body.append('status', form.status)
        body.append('resolution_note', form.resolutionNote.trim())
    }
    if (photo.value) body.append('photo', photo.value)
    return body
}

async function save() {
    if ((await formRef.value?.validate({ silent: true })) === false) return
    if (photo.value && photo.value.size > MAX_PHOTO_BYTES) {
        warning(t('tasks.photoTooLarge'))
        return
    }
    await run(
        async () => {
            const tasks = pb.collection('tasks')
            const options = { expand: 'route,wall' }
            const saved = props.task
                ? await tasks.update<TaskRecord>(
                      props.task.id,
                      buildBody(),
                      options,
                  )
                : await tasks.create<TaskRecord>(buildBody(), options)
            emit('saved', saved)
            open.value = false
        },
        { success: t('tasks.saved') },
    )
}
</script>
