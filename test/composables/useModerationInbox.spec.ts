import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ModerationItemRecord } from '~/types/models'
import { MODERATION_SEEN_KEY } from '~/utils/clientStorage'

const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
const items = ref<ModerationItemRecord[]>([])
const reloadLoaded = vi.fn()
const decideModerationCase = vi.fn()
const getModerationCase = vi.fn()
const hideAuthorContent = vi.fn()
const getPlatformUser = vi.fn()
const refreshList = vi.fn()
const liveRefresh = vi.fn()
const lgAndUp = ref(true)
let query: Record<string, string> = {}
let mounted: (() => void) | undefined

vi.stubGlobal('useI18n', () => ({
    t: (key: string, count?: number) =>
        count === undefined ? key : `${key}:${count}`,
}))
vi.stubGlobal('useDisplay', () => ({ lgAndUp }))
vi.stubGlobal('useNotification', () => notify)
vi.stubGlobal('useModerationSummary', () => ({
    summary: ref({ decide: 2, waiting: 1 }),
    refresh: vi.fn(),
}))
vi.stubGlobal('useRoute', () => ({ query }))
vi.stubGlobal('useAsyncData', () => ({ data: ref([]) }))
vi.stubGlobal('useLiveRefresh', liveRefresh)
vi.stubGlobal('onMounted', (hook: () => void) => {
    mounted = hook
})
vi.stubGlobal('useList', () => ({
    items,
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    error: ref(null),
    refresh: refreshList,
    reloadLoaded,
    loadMore: vi.fn(),
}))
vi.mock('~/api/moderation', () => ({
    decideModerationCase: (...args: unknown[]) => decideModerationCase(...args),
    getModerationCase: (...args: unknown[]) => getModerationCase(...args),
    hideAuthorContent: (...args: unknown[]) => hideAuthorContent(...args),
    listModerationCases: vi.fn(),
}))
vi.mock('~/api/gyms', () => ({ listGyms: vi.fn() }))
vi.mock('~/api/platform', () => ({
    getPlatformUser: (...args: unknown[]) => getPlatformUser(...args),
}))
vi.mock('~/api/auth', () => ({
    useAuthState: () => ({ currentUserId: () => 'me' }),
}))

const { useModerationInbox } = await import('~/composables/useModerationInbox')

function item(id: string, extra: Partial<ModerationItemRecord> = {}) {
    return { id, state: 'open', content_type: 'rating', ...extra } as never
}

function inbox() {
    return useModerationInbox({ gymId: () => 'g1', platform: () => false })
}

describe('useModerationInbox', () => {
    beforeEach(() => {
        items.value = [item('a'), item('b')]
        vi.clearAllMocks()
        decideModerationCase.mockResolvedValue(undefined)
        lgAndUp.value = true
        query = {}
        mounted = undefined
        localStorage.clear()
    })

    it('falls back to the first case only while nothing is chosen', () => {
        const box = inbox()
        expect(box.selected.value?.id).toBe('a')
        box.select(items.value[1]!)
        items.value = [items.value[0]!]
        expect(box.selected.value).toBeNull()
    })

    it('counts the views from the summary', () => {
        const badges = inbox().viewItems.value.map((view) => view.badge)
        expect(badges[0]).toBe('2')
    })

    it('filters by the author and switches to all cases', () => {
        const box = inbox()
        box.filterByAuthor(
            item('a', { context: { author: { id: 'u1', name: 'Ann' } } }),
        )
        expect(box.authorFilter.value).toEqual({ id: 'u1', name: 'Ann' })
        expect(box.view.value).toBe('all')
    })

    it('warns instead of failing when another moderator decided first', async () => {
        decideModerationCase.mockRejectedValue({ status: 404 })
        const box = inbox()
        await box.act(items.value[0]!, 'approve', '')
        expect(notify.warning).toHaveBeenCalledWith(
            'moderation.decidedElsewhere',
        )
        expect(notify.error).not.toHaveBeenCalled()
        expect(reloadLoaded).toHaveBeenCalled()
        expect(box.busy.value).toBe(false)
    })

    it('asks for a reason before hiding or rejecting, and approves at once', async () => {
        const box = inbox()
        box.start(items.value[0]!, 'hide')
        box.start(items.value[0]!, 'reject')
        expect(box.decisionOpen.value).toBe(true)
        expect(box.pending.value?.action).toBe('reject')
        expect(decideModerationCase).not.toHaveBeenCalled()

        box.decisionOpen.value = false
        box.start(items.value[1]!, 'approve')
        await vi.waitFor(() => expect(notify.success).toHaveBeenCalled())
        expect(decideModerationCase).toHaveBeenCalledWith('b', {
            action: 'approve',
            reason: '',
        })
        expect(box.decisionOpen.value).toBe(false)
    })

    it('publishes a pending upload and offers to undo a hide', async () => {
        const box = inbox()
        await box.act(item('p', { state: 'pending' }), 'approve', '')
        expect(notify.success).toHaveBeenLastCalledWith(
            'moderation.done.publish',
            undefined,
        )

        box.decisionOpen.value = true
        box.sheetOpen.value = true
        await box.act(items.value[0]!, 'hide', 'spam')
        expect(decideModerationCase).toHaveBeenLastCalledWith('a', {
            action: 'hide',
            reason: 'spam',
        })
        expect(box.decisionOpen.value).toBe(false)
        expect(box.sheetOpen.value).toBe(false)
        const undo = notify.success.mock.lastCall![1] as { onClick: () => void }
        undo.onClick()
        await vi.waitFor(() =>
            expect(decideModerationCase).toHaveBeenLastCalledWith('a', {
                action: 'restore',
                reason: '',
            }),
        )

        decideModerationCase.mockRejectedValueOnce({ status: 403 })
        undo.onClick()
        await vi.waitFor(() =>
            expect(notify.error).toHaveBeenCalledWith(
                'moderation.decidedElsewhere',
            ),
        )
    })

    it('keeps the decision dialog open when sending fails', async () => {
        decideModerationCase.mockRejectedValue({ status: 500 })
        const box = inbox()
        box.decisionOpen.value = true
        await box.act(items.value[0]!, 'hide', 'spam')
        expect(notify.error).toHaveBeenCalledWith('notifications.error.generic')
        expect(box.decisionOpen.value).toBe(true)
        expect(reloadLoaded).not.toHaveBeenCalled()
        expect(box.busy.value).toBe(false)
    })

    it('spells out what a decision does', () => {
        const reports = [{ status: 'open' }, { status: 'decided' }]
        const reported = item('a', { context: { reports } as never })
        expect(inbox().consequencesOf(reported, 'reject')).toEqual([
            'moderation.decision.declineGone',
            'moderation.decision.authorInformed',
        ])
        expect(inbox().consequencesOf(reported, 'hide')).toEqual([
            'moderation.decision.hiddenNow',
            'moderation.decision.authorInformed',
            'moderation.decision.reportersInformed:1',
            'moderation.decision.restorable',
        ])
        const platform = useModerationInbox({
            gymId: () => undefined,
            platform: () => true,
        })
        expect(platform.consequencesOf(items.value[0]!, 'hide')).toEqual([
            'moderation.decision.hiddenNow',
            'moderation.decision.authorInformed',
            'moderation.decision.platformLock',
        ])
    })

    it('only suspends authors who are neither admins nor yourself', async () => {
        const box = inbox()
        const by = (id: string) =>
            item('a', { context: { author: { id, name: id } } as never })
        await box.openSuspend(items.value[0]!)
        expect(getPlatformUser).not.toHaveBeenCalled()

        getPlatformUser.mockResolvedValueOnce({ id: 'x', platform_admin: true })
        await box.openSuspend(by('x'))
        getPlatformUser.mockResolvedValueOnce({ id: 'me' })
        await box.openSuspend(by('me'))
        expect(notify.error).toHaveBeenCalledTimes(2)
        expect(notify.error).toHaveBeenCalledWith(
            'moderation.author.cannotSuspend',
        )
        getPlatformUser.mockRejectedValueOnce(new Error('down'))
        await box.openSuspend(by('y'))
        expect(notify.error).toHaveBeenLastCalledWith(
            'notifications.error.generic',
        )
        expect(box.suspendUser.value).toBeNull()

        getPlatformUser.mockResolvedValueOnce({ id: 'u1' })
        await box.openSuspend(by('u1'))
        expect(box.suspendUser.value).toEqual({ id: 'u1' })
    })

    it('hides all content of an author and reports the count', async () => {
        const box = inbox()
        await box.hideAuthor('spam')
        expect(hideAuthorContent).not.toHaveBeenCalled()

        box.authorTarget.value = item('a', {
            context: { author: { id: 'u1', name: 'Ann' } } as never,
        })
        hideAuthorContent.mockResolvedValueOnce({ hidden: 3 })
        await box.hideAuthor('spam')
        expect(hideAuthorContent).toHaveBeenCalledWith('u1', 'spam')
        expect(notify.success).toHaveBeenCalledWith('moderation.done.hideAll:3')
        expect(box.authorTarget.value).toBeNull()

        box.authorTarget.value = item('a', {
            context: { author: { id: 'u1', name: 'Ann' } } as never,
        })
        hideAuthorContent.mockRejectedValueOnce(new Error('down'))
        await box.hideAuthor('spam')
        expect(notify.error).toHaveBeenCalledWith('notifications.error.generic')
        expect(box.authorTarget.value).not.toBeNull()
    })

    it('opens a linked case in its view even beyond the loaded page', async () => {
        query = { case: 'far' }
        lgAndUp.value = false
        getModerationCase.mockResolvedValue(item('far', { state: 'hidden' }))
        const box = inbox()
        mounted!()
        await vi.waitFor(() => expect(box.loaded.value).toBe(true))
        expect(getModerationCase).toHaveBeenCalledWith('far')
        expect(box.view.value).toBe('hidden')
        expect(box.selected.value?.id).toBe('far')
        expect(box.sheetOpen.value).toBe(true)
        expect(refreshList).toHaveBeenCalled()
    })

    it('opens the case sheet on phones only', () => {
        const box = inbox()
        box.select(items.value[1]!)
        expect(box.sheetOpen.value).toBe(false)
        lgAndUp.value = false
        const phone = inbox()
        phone.select(items.value[1]!)
        expect(phone.sheetOpen.value).toBe(true)
    })

    it('marks cases newer than the last visit and remembers this one', () => {
        localStorage.setItem(
            MODERATION_SEEN_KEY,
            JSON.stringify({ g1: '2026-01-02T00:00:00.000Z' }),
        )
        items.value = [
            item('old', { created: '2026-01-01T00:00:00.000Z' }),
            item('new', { created: '2026-01-03T00:00:00.000Z' }),
        ]
        getModerationCase.mockResolvedValue(null)
        const box = inbox()
        mounted!()
        expect(box.newCount.value).toBe(1)
        const seen = JSON.parse(localStorage.getItem(MODERATION_SEEN_KEY)!)
        expect(seen.g1 > '2026-01-02').toBe(true)
    })

    it('listens on the gym or the platform moderation topic', () => {
        inbox()
        useModerationInbox({ gymId: () => undefined, platform: () => true })
        const topics = liveRefresh.mock.calls.map(([topic]) => topic())
        expect(topics).toEqual(['moderation:g1', 'moderation:platform'])
        expect(liveRefresh.mock.calls[0]![1]).toBe(reloadLoaded)
    })
})
