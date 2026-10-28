<template>
    <div class="tasks-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('tasks.pageTitle')">
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-plus"
                    data-testid="tasks-new"
                    @click="openForm(null)"
                >
                    {{ t('tasks.newTitle') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <FilterBar
            v-model="search"
            :search-label="t('actions.search')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        v-model="kindFilter"
                        :label="t('tasks.kind')"
                        :items="kindItems"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="tasks-filter-kind"
                        @clear="kindFilter = null"
                    />
                    <FilterSelect
                        v-model="assigneeFilter"
                        :label="t('tasks.assignee')"
                        :items="assigneeFilterItems"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="tasks-filter-assignee"
                        @clear="assigneeFilter = null"
                    />
                    <FilterSelect
                        v-if="locationItems.length > 1"
                        v-model="locationFilter"
                        :label="t('tasks.location')"
                        :items="locationItems"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="tasks-filter-location"
                        @clear="locationFilter = null"
                    />
                </div>
            </template>
            <template #below>
                <div class="flex flex-wrap gap-2 px-3 pb-3">
                    <UButton
                        v-for="quick in quickFilters"
                        :key="quick.key"
                        :icon="quick.icon"
                        size="sm"
                        :color="quick.active ? 'primary' : 'neutral'"
                        :variant="quick.active ? 'soft' : 'outline'"
                        class="rounded-full"
                        :aria-pressed="quick.active"
                        :data-testid="`tasks-quick-${quick.key}`"
                        @click="quick.toggle"
                    >
                        {{ t(`tasks.quick.${quick.key}`) }}
                    </UButton>
                </div>
            </template>
        </FilterBar>

        <TaskBoard
            ref="boardRef"
            class="mt-4"
            :query="boardQuery"
            :assignee-names="assigneeNames"
            @edit="openForm"
        />

        <TaskFormDialog v-model="formOpen" :task="editedTask" @saved="reload" />
    </div>
</template>

<script setup lang="ts">
import { translatedItems } from '~/utils/translatedItems'
import { gymTopic, tasksTopic } from '#shared/utils/topics'
import { TASK_KINDS } from '#shared/utils/tasks'
import { useTimeoutFn } from '@vueuse/core'
import type { GymEvent } from '~/composables/useRealtime'
import { listTaskAssignees, type TaskQuery } from '~/api/tasks'
import { useAuthState } from '~/api/auth'
import type { TaskKind, TaskRecord } from '~/types/models'

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_tasks',
})

const MINE = 'mine'

const { t } = useI18n()
const gymId = useCurrentGymId()
const { items: locationItems } = useLocations()

const boardRef = ref<{ reload: () => Promise<void> }>()
const initialSearch = (useRoute().query.q as string | undefined) ?? ''
const search = ref(initialSearch)
const debouncedSearch = ref(initialSearch)
const kindFilter = ref<string | null>(null)
const assigneeFilter = ref<string | null>(null)
const locationFilter = ref<string | null>(null)
const urgentOnly = ref(false)
const overdueOnly = ref(false)
const formOpen = ref(false)
const editedTask = ref<TaskRecord | null>(null)

const activeFilterCount = computed(
    () =>
        [kindFilter.value, assigneeFilter.value, locationFilter.value].filter(
            Boolean,
        ).length,
)

const { data: assignees, refresh: refreshAssignees } = await useAsyncData(
    'task-assignees',
    () => listTaskAssignees(gymId.value),
)
// assignees are whoever holds manage_tasks, so member and role changes reshape the list
useLiveRefresh(() => gymTopic(gymId.value), refreshAssignees, {
    when: (event: GymEvent) =>
        event.kind === 'membership.changed' || event.kind === 'role.changed',
})

const assigneeNames = computed(
    () =>
        new Map(
            (assignees.value ?? []).map((assignee) => [
                assignee.user,
                assignee.name,
            ]),
        ),
)

const kindItems = computed(() => translatedItems(TASK_KINDS, 'tasks.kinds', t))
const assigneeFilterItems = computed(() =>
    (assignees.value ?? []).map((assignee) => ({
        value: assignee.user,
        label: assignee.name,
    })),
)

const quickFilters = computed(() => [
    {
        key: 'mine',
        icon: 'i-lucide-user',
        active: assigneeFilter.value === MINE,
        toggle: () =>
            (assigneeFilter.value =
                assigneeFilter.value === MINE ? null : MINE),
    },
    {
        key: 'urgent',
        icon: 'i-lucide-siren',
        active: urgentOnly.value,
        toggle: () => (urgentOnly.value = !urgentOnly.value),
    },
    {
        key: 'overdue',
        icon: 'i-lucide-calendar-x',
        active: overdueOnly.value,
        toggle: () => (overdueOnly.value = !overdueOnly.value),
    },
])

const boardQuery = computed<TaskQuery>(() => ({
    kind: kindFilter.value as TaskKind | null,
    assignee:
        assigneeFilter.value === MINE
            ? useAuthState().currentUserId()
            : assigneeFilter.value,
    location: locationFilter.value,
    urgent: urgentOnly.value,
    overdue: overdueOnly.value,
    q: debouncedSearch.value.trim(),
}))

async function reload() {
    await boardRef.value?.reload()
}

useHead({ title: t('page.title.tasks') })

const { start: setSearchSoon } = useTimeoutFn(
    (term: string) => (debouncedSearch.value = term),
    300,
    { immediate: false },
)
watch(search, (term) => setSearchSoon(term))

useLiveRefresh(() => tasksTopic(gymId.value), reload, { delayMs: 500 })

function clearFilters() {
    kindFilter.value = null
    assigneeFilter.value = null
    locationFilter.value = null
    urgentOnly.value = false
    overdueOnly.value = false
}

function openForm(task: TaskRecord | null) {
    editedTask.value = task
    formOpen.value = true
}

useLinkedTask(gymId, formOpen, openForm)
</script>
