import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ModerationItemRecord } from '~/types/models'

const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
const items = ref<ModerationItemRecord[]>([])
const reloadLoaded = vi.fn()
const decideModerationCase = vi.fn()

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
vi.stubGlobal('useDisplay', () => ({ lgAndUp: ref(true) }))
vi.stubGlobal('useNotification', () => notify)
vi.stubGlobal('useModerationSummary', () => ({
    summary: ref({ decide: 2, waiting: 1 }),
    refresh: vi.fn(),
}))
vi.stubGlobal('useRoute', () => ({ query: {} }))
vi.stubGlobal('useAsyncData', () => ({ data: ref([]) }))
vi.stubGlobal('useLiveRefresh', vi.fn())
vi.stubGlobal('onMounted', vi.fn())
vi.stubGlobal('useList', () => ({
    items,
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    error: ref(null),
    refresh: vi.fn(),
    reloadLoaded,
    loadMore: vi.fn(),
}))
vi.mock('~/api/moderation', () => ({
    decideModerationCase: (...args: unknown[]) => decideModerationCase(...args),
    getModerationCase: vi.fn(),
    hideAuthorContent: vi.fn(),
    listModerationCases: vi.fn(),
}))
vi.mock('~/api/gyms', () => ({ listGyms: vi.fn() }))
vi.mock('~/api/platform', () => ({ getPlatformUser: vi.fn() }))

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
})
