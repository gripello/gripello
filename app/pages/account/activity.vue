<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader
            :title="seesEverything ? t('audit.title') : t('audit.titleOwn')"
        />

        <FilterBar
            v-model="search"
            :search-label="t('audit.searchLabel')"
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        :label="t('audit.filterAction')"
                        v-model="actionFilter"
                        :items="actionItems"
                        label-key="title"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="audit-filter-action"
                    />
                    <FilterSelect
                        :label="t('audit.filterCollection')"
                        v-model="collectionFilter"
                        :items="collectionItems"
                        label-key="title"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="audit-filter-collection"
                    />
                    <FilterSelect
                        v-if="auditGyms.length > 1"
                        :label="t('audit.filter.gym')"
                        v-model="gymFilter"
                        :items="gymItems"
                        label-key="title"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="audit-filter-gym"
                    />
                    <FilterSelect
                        v-if="auditGyms.length"
                        :label="t('audit.filter.actor')"
                        v-model="actorFilter"
                        :items="actorItems"
                        label-key="title"
                        value-key="value"
                        :search-input="{ placeholder: t('actions.search') }"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="audit-filter-actor"
                    />
                    <FilterSelect
                        :label="t('audit.filterPeriod')"
                        v-model="periodFilter"
                        :items="periodItems"
                        label-key="title"
                        value-key="value"
                        data-testid="audit-filter-period"
                    />
                </div>
            </template>
        </FilterBar>

        <div class="mt-4">
            <LayoutLoadingState v-if="loading" />

            <LayoutEmptyState
                v-if="!loading && !entries.length"
                icon="i-lucide-clipboard-clock"
                :title="t('audit.empty')"
                :hint="t('audit.emptyHint')"
            />

            <LayoutListGroup v-if="!loading && entries.length">
                <AuditCard
                    v-for="entry in entries"
                    :key="entry.id"
                    :entry="entry"
                />
            </LayoutListGroup>

            <div v-if="hasMore" class="text-center mt-4">
                <UButton
                    color="neutral"
                    variant="soft"
                    :loading="loadingMore"
                    data-testid="audit-load-more"
                    @click="loadMore"
                >
                    {{ t('actions.load_more') }}
                </UButton>
            </div>

            <p
                class="text-xs text-muted text-center mt-6"
                data-testid="audit-retention-note"
            >
                {{
                    t(
                        'audit.retentionNote',
                        { days: retentionDays },
                        retentionDays,
                    )
                }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { RecordChange } from '~/composables/useRealtime'
import { listGyms } from '~/api/gyms'
import { listMembers } from '~/api/members'
import { useAuthState } from '~/api/auth'
import { listGymAudit, listOwnAudit, listPlatformAudit } from '~/api/audit'
import type { AuditAction, AuditLogRecord } from '~/types/models'
import { gymTitle } from '~/utils/gymNames'
import {
    AUDIT_ACTOR_GUESTS,
    AUDIT_ACTOR_PLATFORM,
    AUDIT_ACTIONS,
    matchesAuditActor,
    AUDIT_PERIODS,
    AUDITED_COLLECTIONS,
    auditPeriodStart,
    type AuditPeriod,
} from '~/utils/audit'

const { t } = useI18n()
const { can, isPlatformAdmin, gymMemberships } = usePermissions()
const { id: cookieGymId } = useGym()
const currentUserId = useAuthState().currentUserId()

const PER_PAGE = 48

const loading = ref(true)
const loadingMore = ref(false)

const entries = ref<AuditLogRecord[]>([])
const page = ref(1)
const totalItems = ref(0)
const hasMore = computed(() => entries.value.length < totalItems.value)

const search = ref('')
const actionFilter = ref<AuditAction | null>(null)
const collectionFilter = ref<string | null>(null)
const periodFilter = ref<AuditPeriod>('30d')

const { data: auditGyms } = await useAsyncData(
    'audit-gyms',
    async () =>
        isPlatformAdmin.value
            ? listGyms()
            : gymMemberships.value.flatMap((membership) =>
                  membership.expand?.gym &&
                  can('view_audit_log', membership.gym)
                      ? [membership.expand.gym]
                      : [],
              ),
    { default: () => [] },
)

const gymFilter = ref<string | null>(
    auditGyms.value.some((gym) => gym.id === cookieGymId.value)
        ? cookieGymId.value
        : null,
)
const actorFilter = ref<string | null>(null)
const defaultGym = gymFilter.value

const gymItems = computed(() =>
    auditGyms.value.map((gym) => ({ value: gym.id, title: gymTitle(gym) })),
)

const { data: auditMembers } = useAsyncData(
    'audit-members',
    async () => (await listMembers(gymFilter.value ?? cookieGymId.value)).items,
    {
        default: () => [],
        server: false,
        watch: [gymFilter],
        enabled: () =>
            auditGyms.value.length > 0 &&
            !!(gymFilter.value ?? cookieGymId.value),
    },
)

const actorItems = computed(() => [
    { value: currentUserId, title: t('audit.actor.me') },
    { value: AUDIT_ACTOR_GUESTS, title: t('audit.actor.guests') },
    { value: AUDIT_ACTOR_PLATFORM, title: t('audit.superuser') },
    ...auditMembers.value.flatMap(({ user }) => {
        if (user.id === currentUserId) return []
        const fullName = [user.firstname, user.name].filter(Boolean).join(' ')
        return [{ value: user.id, title: fullName || user.username }]
    }),
])

const seesEverything = computed(() => can('view_audit_log'))

const activeFilterCount = computed(
    () =>
        (actionFilter.value ? 1 : 0) +
        (collectionFilter.value ? 1 : 0) +
        (periodFilter.value !== '30d' ? 1 : 0) +
        (actorFilter.value ? 1 : 0) +
        (gymFilter.value !== defaultGym ? 1 : 0),
)

const actionItems = computed(() =>
    AUDIT_ACTIONS.map((value) => ({
        value,
        title: t(`audit.action.${value}`),
    })),
)
const collectionItems = computed(() =>
    AUDITED_COLLECTIONS.map((value) => ({
        value,
        title: t(`audit.collection.${value}`),
    })),
)
const periodItems = computed(() =>
    AUDIT_PERIODS.map((value) => ({
        value,
        title: t(`audit.period.${value}`),
    })),
)

async function fetchList(target = 1) {
    const query = {
        q: search.value,
        action: actionFilter.value,
        collection: collectionFilter.value,
        from: auditPeriodStart(periodFilter.value),
        actor: actorFilter.value,
        page: target,
        limit: PER_PAGE,
    }
    const options = { requestKey: 'auditList' }
    const result = gymFilter.value
        ? await listGymAudit(gymFilter.value, query, options)
        : isPlatformAdmin.value
          ? await listPlatformAudit(query, options)
          : await listOwnAudit(query, options)

    totalItems.value = result.total ?? 0
    entries.value =
        target === 1 ? result.items : [...entries.value, ...result.items]
    page.value = target
    return result
}

const { data: initial } = await useAsyncData('activity-log', async () => {
    await fetchList(1)
    return { entries: entries.value, totalItems: totalItems.value }
})
if (initial.value) {
    entries.value = initial.value.entries
    totalItems.value = initial.value.totalItems
}
loading.value = false

const { data: settings } = useNuxtData('settings')
const retentionDays = computed(() => settings.value?.audit_retention_days ?? 90)

useRealtime('audit_logs', (e: RecordChange<AuditLogRecord>) => {
    if (e.action !== 'create' || !e.record) return
    if (page.value !== 1) return
    if (!matchesFilters(e.record)) return
    if (entries.value.some((entry) => entry.id === e.record.id)) return
    entries.value = [e.record as AuditLogRecord, ...entries.value]
    totalItems.value += 1
})

function matchesFilters(record: AuditLogRecord) {
    if (actionFilter.value && record.action !== actionFilter.value) return false
    if (!matchesAuditActor(record, actorFilter.value)) return false
    if (gymFilter.value && record.gym !== gymFilter.value) return false
    if (
        collectionFilter.value &&
        record.collection_name !== collectionFilter.value
    ) {
        return false
    }
    const term = search.value.trim().toLowerCase()
    if (!term) return true
    return [record.actor_label, record.record_id, record.collection_name].some(
        (value) => (value ?? '').toLowerCase().includes(term),
    )
}

useHead({
    title: t('page.title.activity'),
    meta: [{ name: 'description', content: t('page.content.activity') }],
})

definePageMeta({
    middleware: ['auth'],
})

let searchDebounce: ReturnType<typeof setTimeout> | undefined

watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => void reload(), 300)
})

watch(
    [actionFilter, collectionFilter, periodFilter, actorFilter, gymFilter],
    () => void reload(),
)

onBeforeUnmount(() => clearTimeout(searchDebounce))

async function reload() {
    loading.value = true
    try {
        await fetchList(1)
    } catch (err) {
        console.error('Failed to load audit log:', err)
    } finally {
        loading.value = false
    }
}

async function loadMore() {
    loadingMore.value = true
    try {
        await fetchList(page.value + 1)
    } catch (err) {
        console.error('Failed to load more audit entries:', err)
    } finally {
        loadingMore.value = false
    }
}

function clearFilters() {
    actionFilter.value = null
    collectionFilter.value = null
    periodFilter.value = '30d'
    actorFilter.value = null
    gymFilter.value = defaultGym
}
</script>
