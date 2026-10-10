<template>
    <div class="flex flex-col gap-4">
        <LayoutPanel as="div">
            <div class="flex flex-wrap items-center gap-2">
                <SegmentedControl
                    v-model="view"
                    :items="viewItems"
                    test-id="moderation-view"
                    data-testid="moderation-views"
                />
                <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    :placeholder="t('actions.search')"
                    :aria-label="t('actions.search')"
                    class="min-w-48 flex-1"
                    data-testid="moderation-search"
                />
                <FilterSelect
                    v-model="contentType"
                    :label="t('moderation.filterType')"
                    :items="typeItems"
                    value-key="value"
                    :placeholder="t('filter.all')"
                    clear
                    data-testid="moderation-filter-type"
                    @clear="contentType = undefined"
                />
                <FilterSelect
                    v-if="platform"
                    v-model="gymFilter"
                    :label="t('moderation.filterGym')"
                    :items="gymItems"
                    value-key="value"
                    :placeholder="t('filter.all')"
                    clear
                    data-testid="moderation-filter-gym"
                    @clear="gymFilter = undefined"
                />
                <UBadge
                    v-if="authorFilter"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="gap-1"
                >
                    {{ authorFilter.name }}
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="link"
                        size="xs"
                        :aria-label="t('filter.clear')"
                        data-testid="moderation-author-clear"
                        @click="authorFilter = null"
                    />
                </UBadge>
            </div>
        </LayoutPanel>

        <p
            v-if="newCount"
            class="text-sm text-muted"
            data-testid="moderation-new"
        >
            {{ t('moderation.newSinceVisit', newCount) }}
        </p>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="moderation-error"
        />
        <LayoutLoadingState
            v-else-if="!loaded || (loading && !items.length)"
            type="list-item-avatar-three-line, actions"
        />
        <LayoutEmptyState
            v-else-if="!items.length"
            icon="i-lucide-shield-check"
            :title="t(`moderation.empty.${view}`)"
            data-testid="moderation-empty"
        />
        <div v-else class="flex flex-wrap items-start gap-4">
            <div
                class="flex w-full flex-col gap-2.5 lg:w-[26rem] lg:shrink-0"
                data-testid="moderation-list"
            >
                <LayoutListGroup>
                    <ModerationCaseCard
                        v-for="item in items"
                        :key="item.id"
                        :item="item"
                        :selected="lgAndUp && item.id === selected?.id"
                        :is-new="isNewSince(item.created, seenBefore)"
                        :platform="platform"
                        @select="select(item)"
                    />
                </LayoutListGroup>
                <UButton
                    v-if="hasMore"
                    color="neutral"
                    variant="soft"
                    block
                    :loading="loadingMore"
                    data-testid="moderation-load-more"
                    @click="loadMore"
                >
                    {{ t('actions.load_more') }}
                </UButton>
            </div>
            <ModerationCaseDetail
                v-if="lgAndUp && selected"
                :item="selected"
                :actions="actionsOf(selected)"
                :platform="platform"
                :busy="busy"
                class="min-w-0 flex-1 lg:sticky lg:top-20"
                @act="(action) => start(selected!, action)"
                @show-author="filterByAuthor(selected!)"
                @hide-author="authorTarget = selected"
                @suspend-author="openSuspend(selected!)"
            />
            <LayoutEmptyState
                v-else-if="lgAndUp"
                icon="i-lucide-circle-check"
                :title="t('moderation.decidedElsewhere')"
                class="min-w-0 flex-1"
                data-testid="moderation-decided-elsewhere"
            />
        </div>

        <LayoutDialogShell
            v-if="!lgAndUp"
            v-model="sheetOpen"
            sheet-on-mobile
            flush
            closable
            :title="
                selected ? t(`moderation.types.${selected.content_type}`) : ''
            "
        >
            <ModerationCaseDetail
                v-if="selected"
                :item="selected"
                :actions="actionsOf(selected)"
                :platform="platform"
                :busy="busy"
                class="border-0"
                @act="(action) => start(selected!, action)"
                @show-author="filterByAuthor(selected!)"
                @hide-author="authorTarget = selected"
                @suspend-author="openSuspend(selected!)"
            />
        </LayoutDialogShell>

        <ModerationDecisionDialog
            v-model="decisionOpen"
            :title="
                pending ? t(`moderation.confirmTitle.${pending.action}`) : ''
            "
            :subject="pending ? subjectOf(pending.item) : ''"
            :confirm-label="
                pending ? t(`moderation.confirm.${pending.action}`) : ''
            "
            :consequences="
                pending ? consequencesOf(pending.item, pending.action) : []
            "
            :loading="busy"
            @confirm="
                (reason) => pending && act(pending.item, pending.action, reason)
            "
        />

        <ModerationDecisionDialog
            :model-value="!!authorTarget"
            :title="t('moderation.author.hideAll')"
            :subject="authorTarget?.context?.author?.name"
            :confirm-label="t('moderation.author.hideAllConfirm')"
            :consequences="[
                t('moderation.decision.authorAll'),
                t('moderation.decision.authorInformed'),
                t('moderation.decision.restorable'),
            ]"
            :loading="busy"
            @update:model-value="authorTarget = null"
            @confirm="hideAuthor"
        />

        <PlatformSuspendDialog
            v-if="platform"
            :model-value="!!suspendUser"
            :user="suspendUser"
            @update:model-value="suspendUser = null"
            @changed="reloadAll"
        />
    </div>
</template>

<script setup lang="ts">
import { listGyms } from '~/api/gyms'
import {
    decideCase,
    getCase,
    hideAuthor as hideAuthorContent,
    listCases,
} from '~/api/moderation'
import { getPlatformUser } from '~/api/platform'
import { useAuthState } from '~/api/auth'
import type {
    ModerationAction,
    ModerationContentType,
    ModerationItemRecord,
    UserRecord,
} from '~/types/models'
import {
    ACTIONS_NEEDING_REASON,
    GYM_VIEWS,
    MODERATION_CONTENT_TYPES,
    PLATFORM_VIEWS,
    actionLabelKey,
    isNewSince,
    viewOfState,
    moderationActions,
    moderationViewQuery,
    moderationText,
    openReportCount,
    type ModerationView,
} from '~/utils/moderation'
import { MODERATION_SEEN_KEY } from '~/utils/clientStorage'
import { coalesce } from '~/utils/realtimeCache'

const props = defineProps<{ gymId?: string; platform?: boolean }>()

const { t } = useI18n()
const { can } = usePermissions()
const { lgAndUp } = useDisplay()
const {
    success: notifySuccess,
    error: notifyError,
    warning: notifyWarning,
} = useNotification()
const { summary, refresh: refreshSummary } = useModerationSummary()

const view = ref<ModerationView>('decide')
const route = useRoute()
const search = ref(String(route.query.search ?? ''))
const contentType = ref<ModerationContentType | undefined>()
const gymFilter = ref<string | undefined>(
    (route.query.gym as string | undefined) || undefined,
)
const authorFilter = ref<{ id: string; name: string } | null>(null)

const viewItems = computed(() =>
    (props.platform ? PLATFORM_VIEWS : GYM_VIEWS).map((value) => {
        const count = viewCount(value)
        return {
            value,
            label: t(`moderation.views.${value}`),
            badge: count ? String(count) : undefined,
        }
    }),
)
const typeItems = computed(() =>
    MODERATION_CONTENT_TYPES.map((value) => ({
        value,
        label: t(`moderation.types.${value}`),
    })),
)

const { data: gyms } = useAsyncData(
    'moderation-gyms',
    () => (props.platform ? listGyms({ all: true }) : Promise.resolve([])),
    { default: () => [], server: false },
)
const gymItems = computed(() =>
    gyms.value.map((gym) => ({ value: gym.id, label: gym.name })),
)

function viewCount(value: ModerationView) {
    if (!summary.value) return 0
    if (value === 'decide') return summary.value.decide
    if (value === 'approval') return summary.value.waiting ?? 0
    return 0
}

const {
    items,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    reloadLoaded,
    loadMore,
} = usePbList<ModerationItemRecord>(
    (page, limit) =>
        listCases(
            {
                ...moderationViewQuery(view.value, props.platform),
                gym: props.gymId ?? gymFilter.value,
                content_type: contentType.value,
                author: authorFilter.value?.id,
                q: search.value.trim(),
                page,
                limit,
                total: true,
            },
            { requestKey: 'moderationInbox' },
        ),
    { perPage: 30, requestKey: 'moderationInbox' },
)

const loaded = ref(false)
const selectedId = ref<string | null>(null)
const sheetOpen = ref(false)
// A case opened by link may sit beyond the loaded page; keep showing it.
const requestedItem = ref<ModerationItemRecord | null>(null)
// Only an unchosen selection falls back to the first case: a case decided
// elsewhere must not silently swap the one being read for another.
const selected = computed(() => {
    if (!selectedId.value) return items.value[0] ?? null
    return (
        items.value.find((item) => item.id === selectedId.value) ??
        (requestedItem.value?.id === selectedId.value
            ? requestedItem.value
            : null)
    )
})
watch(selected, (item) => {
    if (!item) sheetOpen.value = false
})

function select(item: ModerationItemRecord) {
    selectedId.value = item.id
    requestedItem.value = null
    if (!lgAndUp.value) sheetOpen.value = true
}

async function openRequestedCase(id: unknown) {
    if (typeof id !== 'string' || !id) return
    const item = await getCase(id).catch(() => null)
    if (!item) return
    view.value = viewOfState(item.state, !!props.platform)
    requestedItem.value = item
    selectedId.value = item.id
    if (!lgAndUp.value) sheetOpen.value = true
}

async function load() {
    await openRequestedCase(route.query.case)
    await refresh()
    loaded.value = true
}

function reloadAll() {
    return Promise.all([reloadLoaded(), refreshSummary()])
}

watch([view, contentType, gymFilter, authorFilter], () => void refresh())
// Nuxt keeps this page when only the query changes (search hit, notification link).
watch(
    () => route.query,
    (query, previous) => {
        if (query.search !== previous.search)
            search.value = String(query.search ?? '')
        if (query.gym !== previous.gym)
            gymFilter.value = (query.gym as string | undefined) || undefined
        if (query.case !== previous.case) void openRequestedCase(query.case)
    },
)
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => void refresh(), 300)
})
onBeforeUnmount(() => clearTimeout(searchDebounce))

const seenScope = computed(() =>
    props.platform ? 'platform' : (props.gymId ?? ''),
)
const seenBefore = ref<string>()
const newCount = computed(
    () =>
        items.value.filter((item) => isNewSince(item.created, seenBefore.value))
            .length,
)

function readSeen(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(MODERATION_SEEN_KEY) ?? '{}')
    } catch {
        return {}
    }
}

function markSeen() {
    try {
        localStorage.setItem(
            MODERATION_SEEN_KEY,
            JSON.stringify({
                ...readSeen(),
                [seenScope.value]: new Date().toISOString(),
            }),
        )
    } catch {
        // storage blocked: no "new" markers next time
    }
}

const reloadSoon = coalesce(reloadLoaded)
useRealtime(
    () =>
        props.platform
            ? 'moderation:platform'
            : props.gymId && `moderation:${props.gymId}`,
    reloadSoon,
    { onReactivate: reloadSoon },
)
onMounted(() => {
    seenBefore.value = readSeen()[seenScope.value]
    markSeen()
    void load()
})

function gymStaffOf(item: ModerationItemRecord) {
    return !!item.gym && can('manage_comments', item.gym)
}

function actionsOf(item: ModerationItemRecord) {
    return moderationActions(item, {
        platform: !!props.platform,
        gymStaff: gymStaffOf(item),
    })
}

function subjectOf(item: ModerationItemRecord) {
    return [
        t(`moderation.types.${item.content_type}`),
        item.context?.author?.name,
        item.context?.route?.name,
    ]
        .filter(Boolean)
        .join(' · ')
}

function consequencesOf(item: ModerationItemRecord, action: ModerationAction) {
    const reports = openReportCount(item.context?.reports)
    if (action === 'reject')
        return [
            t('moderation.decision.declineGone'),
            t('moderation.decision.authorInformed'),
        ]
    return [
        t('moderation.decision.hiddenNow'),
        t('moderation.decision.authorInformed'),
        ...(reports
            ? [t('moderation.decision.reportersInformed', reports)]
            : []),
        props.platform
            ? t('moderation.decision.platformLock')
            : t('moderation.decision.restorable'),
    ]
}

const busy = ref(false)
const decisionOpen = ref(false)
const pending = ref<{
    item: ModerationItemRecord
    action: ModerationAction
} | null>(null)
const authorTarget = ref<ModerationItemRecord | null>(null)
const suspendUser = ref<UserRecord | null>(null)

// The dialog needs the current suspension, and the server refuses admins and yourself.
async function openSuspend(item: ModerationItemRecord) {
    const authorId = item.context?.author?.id
    if (!authorId) return
    const user = await getPlatformUser(authorId, {
        fields: 'id,username,firstname,name,platform_admin,suspended_until,suspension_reason',
    }).catch(() => null)
    if (!user) return notifyError(t('notifications.error.generic'))
    if (user.platform_admin || user.id === useAuthState().currentUserId())
        return notifyError(t('moderation.author.cannotSuspend'))
    suspendUser.value = user
}

function start(item: ModerationItemRecord, action: ModerationAction) {
    if (!ACTIONS_NEEDING_REASON.includes(action))
        return void act(item, action, '')
    pending.value = { item, action }
    decisionOpen.value = true
}

async function send(
    item: ModerationItemRecord,
    action: ModerationAction,
    reason: string,
) {
    await decideCase(item.id, { action, reason })
}

async function act(
    item: ModerationItemRecord,
    action: ModerationAction,
    reason: string,
) {
    busy.value = true
    try {
        await send(item, action, reason)
        decisionOpen.value = false
        sheetOpen.value = false
        selectedId.value = null
        notifySuccess(
            t(
                `moderation.done.${action === 'approve' && item.state === 'pending' ? 'publish' : action}`,
            ),
            action === 'hide'
                ? {
                      label: t('moderation.undo'),
                      onClick: () =>
                          void send(item, 'restore', '')
                              .then(reloadAll)
                              .catch((err) =>
                                  notifyError(
                                      decidedElsewhere(err)
                                          ? t('moderation.decidedElsewhere')
                                          : t('notifications.error.generic'),
                                  ),
                              ),
                  }
                : undefined,
        )
        await reloadAll()
    } catch (err) {
        if (!decidedElsewhere(err)) {
            notifyError(t('notifications.error.generic'))
            return
        }
        // Someone else decided first: show the current state instead of a failure.
        notifyWarning(t('moderation.decidedElsewhere'))
        decisionOpen.value = false
        selectedId.value = null
        await reloadAll()
    } finally {
        busy.value = false
    }
}

async function hideAuthor(reason: string) {
    const author = authorTarget.value?.context?.author
    if (!author) return
    busy.value = true
    try {
        const result = await hideAuthorContent(author.id, reason)
        authorTarget.value = null
        notifySuccess(t('moderation.done.hideAll', result.hidden))
        await reloadAll()
    } catch {
        notifyError(t('notifications.error.generic'))
    } finally {
        busy.value = false
    }
}

function decidedElsewhere(err: unknown) {
    const status = (err as { status?: number } | null)?.status
    return status === 403 || status === 404
}

function filterByAuthor(item: ModerationItemRecord) {
    const author = item.context?.author
    if (!author) return
    authorFilter.value = {
        id: author.id,
        name: author.name || moderationText(item),
    }
    view.value = 'all'
    sheetOpen.value = false
}
</script>
