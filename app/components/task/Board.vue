<template>
    <LayoutLoadingState v-if="loading" variant="cards" :count="4" />
    <div
        v-else
        data-testid="task-board"
        @touchstart.passive="startSwipe"
        @touchend="endSwipe"
    >
        <LayoutTabs
            v-if="!mdAndUp"
            v-model="activeStatus"
            :items="tabItems"
            :content="false"
            class="mb-3"
            data-testid="task-board-tabs"
        />
        <div class="task-board" :class="{ 'task-board--single': !mdAndUp }">
            <section
                v-for="column in visibleColumns"
                :key="column.status"
                class="task-board__column flex flex-col transition-colors"
                :class="[
                    mdAndUp && 'rounded-xl bg-elevated/40 ring ring-default',
                    dropTarget === column.status &&
                        'ring-2 ring-primary bg-primary/5',
                ]"
                :aria-label="t(`tasks.statuses.${column.status}`)"
                :data-testid="`task-column-${column.status}`"
                @dragover.prevent="dropTarget = column.status"
                @dragleave="dropTarget = null"
                @drop.prevent="onDrop($event, column.status)"
            >
                <header
                    v-if="mdAndUp"
                    class="flex items-center gap-2 px-3 py-2.5 border-b border-default"
                >
                    <UIcon
                        :name="TASK_STATUS_ICONS[column.status]"
                        class="size-4"
                        :class="STATUS_TEXT[taskStatusColor(column.status)]"
                    />
                    <h2 class="text-sm font-semibold text-highlighted">
                        {{ t(`tasks.statuses.${column.status}`) }}
                    </h2>
                    <UBadge
                        color="neutral"
                        variant="soft"
                        size="sm"
                        class="rounded-full tabular-nums"
                        :data-testid="`task-column-count-${column.status}`"
                        >{{ column.tasks.length }}</UBadge
                    >
                    <span
                        v-if="column.status === 'done'"
                        class="ml-auto text-xs text-dimmed"
                        >{{ t('tasks.board.recentlyDone') }}</span
                    >
                </header>
                <div
                    class="flex flex-1 flex-col gap-2"
                    :class="mdAndUp ? 'p-2' : 'gap-3'"
                >
                    <TaskCard
                        v-for="task in column.tasks"
                        :key="task.id"
                        :task="task"
                        :assignee-name="assigneeNames.get(task.assignee ?? '')"
                        :file-token="fileToken"
                        :draggable="mdAndUp ? 'true' : undefined"
                        :class="[
                            mdAndUp
                                ? 'cursor-grab active:cursor-grabbing'
                                : 'touch-manipulation select-none [-webkit-touch-callout:none]',
                            longPress.dragged.value?.id === task.id &&
                                'scale-[0.98] opacity-40',
                        ]"
                        @touchstart.passive="
                            mdAndUp || longPress.startTouch($event, task)
                        "
                        @contextmenu="mdAndUp || $event.preventDefault()"
                        @dragstart="startDrag($event, task)"
                        @dragend="endDrag"
                        @status="changeStatus"
                        @edit="emit('edit', $event)"
                    />
                    <UEmpty
                        v-if="!column.tasks.length"
                        variant="naked"
                        size="xs"
                        :icon="TASK_STATUS_ICONS[column.status]"
                        :description="t('tasks.board.emptyColumn')"
                        class="flex-1"
                        :class="
                            !mdAndUp &&
                            'rounded-lg border border-dashed border-default py-12'
                        "
                    />
                </div>
            </section>
        </div>

        <Teleport to="body">
            <div
                v-if="longPress.dragged.value && longPress.position.value"
                class="pointer-events-none fixed inset-0 z-50"
                data-testid="task-drop-overlay"
            >
                <div
                    class="absolute inset-0 bg-default/50 backdrop-blur-[2px]"
                />
                <div
                    class="absolute flex max-w-64 -translate-x-1/2 -translate-y-[130%] items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-sm font-semibold text-highlighted shadow-xl ring-2 ring-primary"
                    :style="{
                        left: `${longPress.position.value.x}px`,
                        top: `${longPress.position.value.y}px`,
                    }"
                >
                    <UIcon
                        name="i-lucide-grip-vertical"
                        class="size-4 text-muted"
                    />
                    <span class="truncate">{{
                        taskTitle(longPress.dragged.value, t)
                    }}</span>
                </div>
                <div
                    class="absolute inset-x-3 flex flex-col gap-2"
                    :style="{ bottom: 'calc(var(--app-bottom, 0px) + 12px)' }"
                >
                    <p class="text-center text-xs font-medium text-muted">
                        {{ t('tasks.board.dropHint') }}
                    </p>
                    <div class="grid grid-cols-2 gap-2">
                        <div
                            v-for="status in dropStatuses"
                            :key="status"
                            :data-drop-status="status"
                            class="pointer-events-auto flex h-16 items-center justify-center gap-2 rounded-xl text-sm font-semibold ring-2 transition"
                            :class="
                                longPress.target.value === status
                                    ? 'scale-105 bg-primary/15 text-primary ring-primary'
                                    : 'bg-elevated text-toned ring-default'
                            "
                            :data-testid="`task-drop-${status}`"
                        >
                            <UIcon
                                :name="TASK_STATUS_ICONS[status]"
                                class="size-5"
                                :class="
                                    longPress.target.value !== status &&
                                    STATUS_TEXT[taskStatusColor(status)]
                                "
                            />
                            {{ t(`tasks.statuses.${status}`) }}
                        </div>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
import { isAbortError } from '~/utils/errors'
import {
    ACTIVE_TASK_STATUSES,
    BOARD_STATUSES,
    statusesFilter,
    TASK_STATUS_ICONS,
    taskStatusColor,
    taskTitle,
} from '~/utils/tasks'
import type { TaskRecord, TaskStatus } from '~/types/models'

const ACTIVE_LIMIT = 200
const DONE_LIMIT = 30
const STATUS_TEXT: Record<ReturnType<typeof taskStatusColor>, string> = {
    warning: 'text-warning',
    info: 'text-info',
    secondary: 'text-secondary',
    success: 'text-success',
    neutral: 'text-muted',
}
const DRAG_TYPE = 'application/x-gripello-task'

const props = defineProps<{
    filter: string
    assigneeNames: ReadonlyMap<string, string>
    fileToken?: string
}>()

const emit = defineEmits<{ edit: [task: TaskRecord] }>()

const { t } = useI18n()
const pb = usePocketbase()
const { run } = useAsyncAction()
const { error: notifyError } = useNotification()

const { mdAndUp } = useDisplay()
const activeStatus = ref<TaskStatus>('open')
const tasks = ref<TaskRecord[]>([])
const loading = ref(true)
const dropTarget = ref<TaskStatus | null>(null)

const longPress = useLongPressDrag<TaskRecord>({
    targetAt: ({ x, y }) =>
        document
            .elementFromPoint(x, y)
            ?.closest('[data-drop-status]')
            ?.getAttribute('data-drop-status') ?? null,
    onDrop: (task, status) => void changeStatus(task, status as TaskStatus),
})

const dropStatuses = computed(() =>
    [...BOARD_STATUSES, 'dismissed' as const].filter(
        (status) => status !== longPress.dragged.value?.status,
    ),
)

const columns = computed(() =>
    BOARD_STATUSES.map((status) => ({
        status,
        tasks: tasks.value.filter((task) => task.status === status),
    })),
)

const visibleColumns = computed(() =>
    mdAndUp.value
        ? columns.value
        : columns.value.filter(
              (column) => column.status === activeStatus.value,
          ),
)

const tabItems = computed(() =>
    columns.value.map((column) => ({
        value: column.status,
        label: t(`tasks.statuses.${column.status}`),
        icon: TASK_STATUS_ICONS[column.status],
        badge: {
            label: String(column.tasks.length),
            color: 'neutral' as const,
            variant: 'soft' as const,
        },
    })),
)

const SWIPE_DISTANCE = 60
let swipeStart: { x: number; y: number } | null = null

function startSwipe(event: TouchEvent) {
    const touch = event.touches[0]
    swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : null
}

function endSwipe(event: TouchEvent) {
    const touch = event.changedTouches[0]
    if (mdAndUp.value || !swipeStart || !touch || longPress.dragged.value)
        return
    const dx = touch.clientX - swipeStart.x
    const dy = touch.clientY - swipeStart.y
    swipeStart = null
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return
    const index = BOARD_STATUSES.indexOf(
        activeStatus.value as (typeof BOARD_STATUSES)[number],
    )
    const next = BOARD_STATUSES[index + (dx < 0 ? 1 : -1)]
    if (next) activeStatus.value = next
}

function withFilter(statusFilter: string) {
    return props.filter ? `${statusFilter} && ${props.filter}` : statusFilter
}

async function reload() {
    try {
        const collection = pb.collection('tasks')
        const [active, done] = await Promise.all([
            collection.getList<TaskRecord>(1, ACTIVE_LIMIT, {
                filter: withFilter(statusesFilter(ACTIVE_TASK_STATUSES)),
                sort: '-priority,due_date,-created',
                expand: 'route,wall',
                requestKey: 'taskBoardActive',
            }),
            collection.getList<TaskRecord>(1, DONE_LIMIT, {
                filter: withFilter('status = "done"'),
                sort: '-done_at',
                expand: 'route,wall',
                requestKey: 'taskBoardDone',
            }),
        ])
        tasks.value = [...active.items, ...done.items]
    } catch (error) {
        if (isAbortError(error)) return
        console.error(error)
        notifyError(t('tasks.loadError'))
    } finally {
        loading.value = false
    }
}

async function changeStatus(task: TaskRecord, status: TaskStatus) {
    if (task.status === status) return
    await run(
        async () => {
            const updated = await pb
                .collection('tasks')
                .update<TaskRecord>(
                    task.id,
                    { status },
                    { expand: 'route,wall' },
                )
            tasks.value = tasks.value.map((item) =>
                item.id === updated.id ? updated : item,
            )
        },
        { success: t(`tasks.statusChanged.${status}`) },
    )
}

function startDrag(event: DragEvent, task: TaskRecord) {
    event.dataTransfer?.setData(DRAG_TYPE, task.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDrop(event: DragEvent, status: TaskStatus) {
    const taskId = event.dataTransfer?.getData(DRAG_TYPE)
    endDrag()
    const task = tasks.value.find((item) => item.id === taskId)
    if (task) void changeStatus(task, status)
}

function endDrag() {
    dropTarget.value = null
}

watch(() => props.filter, reload)
onMounted(reload)

defineExpose({ reload })
</script>

<style scoped>
@reference "~/assets/css/main.css";

.task-board {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(220px, 1fr);
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 8px;
}

.task-board--single {
    display: block;
    overflow: visible;
}

.task-board__column {
    min-height: 320px;
}

.task-board--single .task-board__column {
    min-height: 0;
}
</style>
