import { translatedItems } from '~/utils/translatedItems'
import { liveTopics, moderationTopic } from '#shared/utils/topics'
import { useTimeoutFn } from '@vueuse/core'
import { listGyms } from '~/api/gyms'
import {
    decideModerationCase,
    getModerationCase,
    hideAuthorContent,
    listModerationCases,
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
    isNewSince,
    viewOfState,
    moderationViewQuery,
    moderationText,
    openReportCount,
    type ModerationView,
} from '~/utils/moderation'
import { MODERATION_SEEN_KEY } from '~/utils/clientStorage'

export function useModerationInbox(options: {
    gymId: () => string | undefined
    platform: () => boolean
}) {
    const { t } = useI18n()
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
    const activeFilterCount = computed(
        () => Number(!!contentType.value) + Number(!!gymFilter.value),
    )

    function clearFilters() {
        contentType.value = undefined
        gymFilter.value = undefined
    }

    const viewItems = computed(() =>
        (options.platform() ? PLATFORM_VIEWS : GYM_VIEWS).map((value) => {
            const count = viewCount(value)
            return {
                value,
                label: t(`moderation.views.${value}`),
                badge: count ? String(count) : undefined,
            }
        }),
    )
    const typeItems = computed(() =>
        translatedItems(MODERATION_CONTENT_TYPES, 'moderation.types', t),
    )

    const { data: gyms } = useAsyncData(
        'moderation-gyms',
        () =>
            options.platform() ? listGyms({ all: true }) : Promise.resolve([]),
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
    } = useList<ModerationItemRecord>(
        (page, limit) =>
            listModerationCases({
                ...moderationViewQuery(view.value, options.platform()),
                gym: options.gymId() ?? gymFilter.value,
                content_type: contentType.value,
                author: authorFilter.value?.id,
                q: search.value.trim(),
                page,
                limit,
                total: true,
            }),
        { perPage: 30 },
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
        const item = await getModerationCase(id).catch(() => null)
        if (!item) return
        view.value = viewOfState(item.state, !!options.platform())
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
    const { start: refreshSoon } = useTimeoutFn(() => void refresh(), 300, {
        immediate: false,
    })
    watch(search, () => refreshSoon())

    const seenScope = computed(() =>
        options.platform() ? 'platform' : (options.gymId() ?? ''),
    )
    const seenBefore = ref<string>()
    const newCount = computed(
        () =>
            items.value.filter((item) =>
                isNewSince(item.created, seenBefore.value),
            ).length,
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

    useLiveRefresh(
        () =>
            options.platform()
                ? liveTopics.platformModeration
                : options.gymId() && moderationTopic(options.gymId()!),
        reloadLoaded,
    )
    onMounted(() => {
        seenBefore.value = readSeen()[seenScope.value]
        markSeen()
        void load()
    })

    function subjectOf(item: ModerationItemRecord) {
        return [
            t(`moderation.types.${item.content_type}`),
            item.context?.author?.name,
            item.context?.route?.name,
        ]
            .filter(Boolean)
            .join(' · ')
    }

    function consequencesOf(
        item: ModerationItemRecord,
        action: ModerationAction,
    ) {
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
            options.platform()
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
        const user = await getPlatformUser(authorId).catch(() => null)
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
        await decideModerationCase(item.id, { action, reason })
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
                                              : t(
                                                    'notifications.error.generic',
                                                ),
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

    return {
        view,
        search,
        contentType,
        gymFilter,
        authorFilter,
        activeFilterCount,
        clearFilters,
        viewItems,
        typeItems,
        gymItems,
        items,
        loading,
        loadingMore,
        hasMore,
        error,
        loadMore,
        loaded,
        selected,
        sheetOpen,
        select,
        newCount,
        seenBefore,
        subjectOf,
        consequencesOf,
        busy,
        decisionOpen,
        pending,
        authorTarget,
        suspendUser,
        openSuspend,
        start,
        act,
        hideAuthor,
        filterByAuthor,
        reloadAll,
        lgAndUp,
    }
}
