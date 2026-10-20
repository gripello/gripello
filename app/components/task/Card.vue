<template>
    <div
        class="flex flex-col gap-2.5 rounded-lg bg-default p-3 ring transition-shadow hover:shadow-md"
        :class="
            urgentActive ? 'ring-error/60' : 'ring-default hover:ring-accented'
        "
        :data-testid="`task-card-${task.id}`"
        :data-urgent="urgentActive || undefined"
    >
        <div class="flex items-start gap-3">
            <div
                class="size-9 shrink-0 rounded-lg flex items-center justify-center"
                :class="
                    urgentActive
                        ? 'bg-error/10 text-error'
                        : 'bg-elevated text-muted'
                "
            >
                <UIcon :name="taskIcon" class="size-5" />
            </div>

            <div class="min-w-0 flex-1">
                <button
                    type="button"
                    class="text-left text-sm font-semibold text-highlighted leading-snug line-clamp-2 hover:underline focus-visible:underline outline-none"
                    data-testid="task-card-open"
                    @click="emit('edit', task)"
                >
                    <span data-testid="task-card-title">{{
                        taskTitle(task, t)
                    }}</span>
                </button>
                <RouteSummary
                    v-if="route"
                    :route="route"
                    size="sm"
                    :meta="wallLabel"
                    class="mt-1"
                />
                <div
                    v-else-if="wallLabel"
                    class="mt-0.5 flex items-center gap-1.5 text-xs text-muted min-w-0"
                >
                    <UIcon
                        name="i-lucide-brick-wall"
                        class="size-3.5 shrink-0"
                    />
                    <span class="truncate">{{ wallLabel }}</span>
                </div>
            </div>

            <LayoutImageViewer
                v-if="photoUrl"
                :src="photoUrl"
                :alt="t('tasks.photo')"
                class="shrink-0"
                @click="renewFileToken"
            >
                <img
                    :src="thumbUrl"
                    :alt="t('tasks.photo')"
                    class="size-12 rounded-md object-cover ring ring-default"
                    loading="lazy"
                    data-testid="task-card-photo"
                    @error="renewFileToken"
                />
            </LayoutImageViewer>
        </div>

        <p
            v-if="task.description"
            class="text-xs text-toned line-clamp-3 whitespace-pre-line"
        >
            {{ task.description }}
        </p>

        <p
            v-if="task.resolution_note"
            class="flex items-start gap-1.5 text-xs text-muted"
        >
            <UIcon
                name="i-lucide-message-square-check"
                class="size-3.5 mt-px shrink-0"
            />
            <span class="line-clamp-2">{{ task.resolution_note }}</span>
        </p>

        <div v-if="badges.length" class="flex flex-wrap items-center gap-1.5">
            <UBadge
                v-for="badge in badges"
                :key="badge.key"
                size="sm"
                variant="soft"
                :color="badge.color"
                :icon="badge.icon"
                :data-testid="badge.testId"
                :data-level="badge.level"
            >
                {{ badge.label }}
            </UBadge>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-default">
            <UTooltip :text="createdAt">
                <span
                    class="text-xs text-muted tabular-nums"
                    data-testid="task-card-created"
                    >{{ createdAgo }}</span
                >
            </UTooltip>
            <span
                v-if="assigneeName"
                class="flex min-w-0 items-center gap-1.5"
                data-testid="task-card-assignee"
            >
                <ClimberAvatar :name="assigneeName" size="xs" />
                <span class="truncate text-xs text-toned">{{
                    assigneeName
                }}</span>
            </span>

            <div class="ml-auto flex shrink-0 items-center gap-0.5">
                <UDropdownMenu :items="moveItems" :content="{ align: 'end' }">
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :aria-label="t('tasks.actions.moveTo')"
                        data-testid="task-card-move"
                    />
                </UDropdownMenu>
                <UTooltip
                    v-if="task.status === 'open'"
                    :text="t('tasks.actions.start')"
                >
                    <UButton
                        class="icon-btn"
                        icon="i-lucide-play"
                        color="neutral"
                        variant="soft"
                        size="xs"
                        :aria-label="t('tasks.actions.start')"
                        data-testid="task-card-start"
                        @click="emit('status', task, 'in_progress')"
                    />
                </UTooltip>
                <UButton
                    :icon="nextStep.icon"
                    :color="nextStep.color"
                    variant="soft"
                    size="xs"
                    :data-testid="nextStep.testId"
                    @click="emit('status', task, nextStep.status)"
                >
                    {{ nextStep.label }}
                </UButton>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { THUMBS } from '#shared/utils/thumbs'
import { TASK_STATUSES } from '#shared/utils/tasks'
import { fileUrl } from '~/api/client'
import {
    DEFECT_CATEGORY_ICONS,
    isTaskActive,
    isTaskOverdue,
    NORMAL_TASK_PRIORITY,
    TASK_STATUS_ICONS,
    taskAge,
    taskPriorityColor,
    taskPriorityName,
    taskTitle,
    URGENT_TASK_PRIORITY,
} from '~/utils/tasks'
import { formatDate, timeAgo } from '#shared/utils/formatting'
import type {
    RouteRecord,
    TaskRecord,
    TaskStatus,
    WallRecord,
} from '~/types/models'

const gymPath = useGymPath()

const props = defineProps<{
    task: TaskRecord
    assigneeName?: string
}>()

const emit = defineEmits<{
    status: [task: TaskRecord, status: TaskStatus]
    edit: [task: TaskRecord]
}>()

const KIND_ICONS = {
    wish: 'i-lucide-sparkles',
    reset: 'i-lucide-refresh-cw',
    maintenance: 'i-lucide-wrench',
    other: 'i-lucide-list-todo',
} as const

const PRIORITY_ICONS = {
    low: 'i-lucide-arrow-down',
    normal: undefined,
    high: 'i-lucide-arrow-up',
    urgent: 'i-lucide-siren',
} as const

const { t, locale } = useI18n()

const route = computed(
    () => props.task.expand?.route as RouteRecord | undefined,
)
const wallLabel = computed(
    () => (props.task.expand?.wall as WallRecord | undefined)?.name,
)
const active = computed(() => isTaskActive(props.task.status))
const urgentActive = computed(
    () => active.value && props.task.priority === URGENT_TASK_PRIORITY,
)
const taskIcon = computed(() =>
    props.task.kind === 'defect'
        ? DEFECT_CATEGORY_ICONS[props.task.category || 'other']
        : KIND_ICONS[props.task.kind],
)

const createdAgo = computed(() => timeAgo(props.task.created, t, locale.value))
const createdAt = computed(() =>
    formatDate(props.task.created, { locale: locale.value, withTime: true }),
)

const badges = computed(() => {
    const priority = taskPriorityName(props.task.priority)
    const age = taskAge(props.task)
    return [
        props.task.priority !== NORMAL_TASK_PRIORITY && {
            key: 'priority',
            label: t(`tasks.priorities.${priority}`),
            color: taskPriorityColor(props.task.priority),
            icon: PRIORITY_ICONS[priority],
            testId: 'task-card-priority',
        },
        props.task.kind !== 'defect' && {
            key: 'kind',
            label: t(`tasks.kinds.${props.task.kind}`),
            color: 'neutral' as const,
            icon: KIND_ICONS[props.task.kind as keyof typeof KIND_ICONS],
        },
        props.task.due_date && {
            key: 'due',
            label: t('tasks.dueOn', {
                date: formatDate(props.task.due_date, {
                    locale: locale.value,
                }),
            }),
            color: isTaskOverdue(props.task)
                ? ('error' as const)
                : ('neutral' as const),
            icon: 'i-lucide-calendar',
            testId: 'task-card-due',
        },
        active.value &&
            age.level !== 'fresh' && {
                key: 'age',
                label: t('tasks.ageDays', age.days),
                color:
                    age.level === 'stale'
                        ? ('error' as const)
                        : ('warning' as const),
                icon: 'i-lucide-hourglass',
                testId: 'task-card-age',
                level: age.level,
            },
    ].filter((badge) => !!badge)
})

const nextStep = computed(() =>
    active.value
        ? {
              status: 'done' as const,
              label: t('tasks.actions.done'),
              icon: 'i-lucide-check',
              color: 'success' as const,
              testId: 'task-card-done',
          }
        : {
              status: 'open' as const,
              label: t('tasks.actions.reopen'),
              icon: 'i-lucide-rotate-ccw',
              color: 'neutral' as const,
              testId: 'task-card-reopen',
          },
)

const moveItems = computed(() => [
    [
        {
            type: 'label' as const,
            label: t('tasks.actions.moveTo'),
        },
        ...TASK_STATUSES.filter((status) => status !== props.task.status).map(
            (status) => ({
                label: t(`tasks.statuses.${status}`),
                icon: TASK_STATUS_ICONS[status],
                'data-testid': `task-move-${status}`,
                onSelect: () => emit('status', props.task, status),
            }),
        ),
    ],
    [
        {
            label: t('actions.edit'),
            icon: 'i-lucide-pencil',
            'data-testid': 'task-card-edit',
            onSelect: () => emit('edit', props.task),
        },
        ...(route.value
            ? [
                  {
                      label: t('tasks.openRoute'),
                      icon: 'i-lucide-external-link',
                      to: gymPath(`/route?id=${route.value.id}`),
                      'data-testid': 'task-card-route',
                  },
              ]
            : []),
    ],
])

const { token: fileToken, renew: renewFileToken } = useFileToken(() =>
    props.task.photo ? { table: 'tasks', id: props.task.id } : null,
)
const photoUrl = computed(() =>
    fileToken.value
        ? fileUrl('tasks', props.task, props.task.photo, {
              token: fileToken.value,
          })
        : '',
)
const thumbUrl = computed(() =>
    fileToken.value
        ? fileUrl('tasks', props.task, props.task.photo, {
              token: fileToken.value,
              thumb: THUMBS.photo,
          })
        : '',
)
</script>
