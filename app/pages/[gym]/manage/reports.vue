<template>
    <div class="reports-page mx-auto w-full p-4">
        <LayoutPageHeader
            :title="t('reports.title')"
            :subtitle="t('reports.subtitle')"
        />

        <UAlert
            v-if="!mailConfigured"
            color="warning"
            variant="soft"
            icon="i-lucide-mail-x"
            class="mb-4"
            data-testid="reports-mail-warning"
        >
            <template #description>
                <div class="flex flex-wrap items-center gap-2">
                    <span class="alert-message">{{
                        t('reports.mailWarning')
                    }}</span>
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :to="gymPath('/admin/settings')"
                        data-testid="reports-mail-warning-link"
                    >
                        {{ t('reports.mailWarningAction') }}
                    </UButton>
                </div>
            </template>
        </UAlert>

        <FilterBar
            v-model="search"
            :search-label="t('actions.search')"
            :active-filter-count="statusFilter ? 1 : 0"
            @clear="clearFilters"
        >
            <template #filters>
                <div class="contents">
                    <FilterSelect
                        :label="t('reports.filterStatus')"
                        v-model="statusFilter"
                        :items="statusItems"
                        value-key="value"
                        clear
                        :placeholder="t('filter.all')"
                        data-testid="reports-filter-status"
                        @clear="statusFilter = null"
                    />
                </div>
            </template>
        </FilterBar>

        <div class="mt-4">
            <LayoutLoadingState
                v-if="loading"
                type="list-item-avatar-three-line, actions"
                data-testid="reports-skeleton"
            />

            <LayoutEmptyState
                v-if="!loading && !reports.length"
                icon="i-lucide-flag"
                :title="t('reports.empty')"
                :hint="t('reports.emptyHint')"
            />

            <ReportsCard
                v-for="report in loading ? [] : reports"
                :key="report.id"
                :report="report"
                :can-remove="can(removalTarget(report).permission)"
                class="mb-3"
                @decide="openDecision"
            />

            <div v-if="hasMore" class="text-center mt-4">
                <UButton
                    color="neutral"
                    variant="soft"
                    :loading="loadingMore"
                    data-testid="reports-load-more"
                    @click="loadMore"
                >
                    {{ t('actions.load_more') }}
                </UButton>
            </div>
        </div>

        <LayoutDialogShell
            v-model="decisionDialog"
            max-width="520"
            closable
            :title="t('reports.decideTitle')"
            data-testid="report-decision-dialog"
        >
            <p class="text-sm mb-3">
                {{
                    pendingDecision === 'content_removed'
                        ? t('reports.decision.content_removed')
                        : t('reports.decision.content_kept')
                }}
            </p>
            <UFormField
                :label="t('reports.decisionReason')"
                :help="t('reports.decisionReasonHint')"
                :hint="`${decisionReason.length}/2000`"
            >
                <UTextarea
                    v-model="decisionReason"
                    :rows="3"
                    autoresize
                    class="w-full"
                    data-testid="report-decision-reason"
                />
            </UFormField>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="report-decision-cancel"
                    @click="decisionDialog = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    :loading="deciding"
                    :color="
                        pendingDecision === 'content_removed'
                            ? 'error'
                            : 'primary'
                    "
                    data-testid="report-decision-confirm"
                    @click="confirmDecision"
                >
                    {{ t('actions.save') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </div>
</template>

<script setup lang="ts">
import type { ReportDecision, ReportRecord } from '~/types/models'
import { REPORT_STATUSES } from '~/utils/reports'
import { coalesce } from '~/utils/realtimeCache'

const gymPath = useGymPath()

const { t } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()
const { pending: deciding, run: runDecision } = useAsyncAction()
const { can } = usePermissions()
const { error: notifyError } = useNotification()
const contentNotRemoved = new Error('content_not_removed')

function removalTarget(report: ReportRecord) {
    return report.content_type === 'route'
        ? { collection: 'routes', permission: 'manage_routes' }
        : { collection: 'ratings', permission: 'manage_comments' }
}

async function contentStillExists(collection: string, id: string) {
    return pb
        .collection(collection)
        .getOne(id, { fields: 'id', requestKey: null })
        .then(
            () => true,
            (err: { status?: number }) => err?.status !== 404,
        )
}

const pageRoute = useRoute()
const search = ref(String(pageRoute.query.search ?? ''))
watch(
    () => pageRoute.query.search,
    (value) => (search.value = String(value ?? '')),
)
const statusFilter = ref<string | null>(null)

const decisionDialog = ref(false)
const decisionReason = ref('')
const pendingDecision = ref<ReportDecision | null>(null)
const pendingReport = ref<ReportRecord | null>(null)

const statusItems = computed(() =>
    REPORT_STATUSES.map((value) => ({
        value: value as string,
        label: t(`reports.status.${value}`),
    })),
)

function buildFilter() {
    const parts = [gymFilter(pb, gymId.value)]
    if (statusFilter.value) parts.push(`status = "${statusFilter.value}"`)
    const term = search.value.trim()
    if (term) {
        const escaped = term.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
        parts.push(
            `(explanation ~ "${escaped}" || notifier_name ~ "${escaped}" || content_snapshot ~ "${escaped}")`,
        )
    }
    return parts.join(' && ')
}

const {
    items: reports,
    loading,
    loadingMore,
    hasMore,
    refresh: reload,
    reloadLoaded,
    loadMore,
    prefetch,
} = usePbList<ReportRecord>('reports', {
    perPage: 48,
    requestKey: 'reportsList',
    query: () => ({ sort: '-created', filter: buildFilter() }),
})

const { data: mailStatus } = useMailStatus()
const mailConfigured = computed(() => mailStatus.value?.configured !== false)

await prefetch('admin-reports')

useHead({
    title: t('page.title.reports'),
    meta: [{ name: 'description', content: t('page.content.reports') }],
})

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_reports',
})

let searchDebounce: ReturnType<typeof setTimeout> | undefined

watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => void reload(), 300)
})

watch(statusFilter, () => void reload())

onBeforeUnmount(() => clearTimeout(searchDebounce))

const reloadSoon = coalesce(reloadLoaded)
const { subscribe } = usePbSubscription(reloadSoon)
onMounted(() => subscribe('reports', reloadSoon))

function clearFilters() {
    statusFilter.value = null
}

function openDecision(report: ReportRecord, decision: ReportDecision) {
    if (
        decision === 'content_removed' &&
        !can(removalTarget(report).permission)
    ) {
        notifyError(t('reports.removeNotAllowed'))
        return
    }
    pendingReport.value = report
    pendingDecision.value = decision
    decisionReason.value = ''
    decisionDialog.value = true
}

async function confirmDecision() {
    const report = pendingReport.value
    const decision = pendingDecision.value
    if (!report || !decision) return

    await runDecision(
        async () => {
            if (decision === 'content_removed') {
                const { collection, permission } = removalTarget(report)
                if (!can(permission)) throw contentNotRemoved
                try {
                    await pb.collection(collection).delete(report.content_id)
                } catch (err) {
                    if ((err as { status?: number })?.status !== 404) throw err
                    if (await contentStillExists(collection, report.content_id))
                        throw contentNotRemoved
                }
            }

            const updated = await pb
                .collection('reports')
                .update<ReportRecord>(report.id, {
                    status:
                        decision === 'content_removed'
                            ? 'actioned'
                            : 'rejected',
                    decision,
                    decision_reason: decisionReason.value.trim(),
                })

            const index = reports.value.findIndex((r) => r.id === report.id)
            if (index !== -1) reports.value[index] = updated

            decisionDialog.value = false
        },
        {
            success: t('reports.decided'),
            error: (err) =>
                err === contentNotRemoved
                    ? t('reports.removeNotAllowed')
                    : t('notifications.error.generic'),
        },
    )
}
</script>
