import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { useList } from '~/composables/useList'

const notifyError = vi.fn()
vi.stubGlobal('useNotification', () => ({ error: notifyError }))

const loadPage = vi.fn()

function pageOf(ids: string[], totalItems: number) {
    return { items: ids.map((id) => ({ id })), total: totalItems }
}

beforeEach(() => {
    loadPage.mockReset()
    notifyError.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

function createList() {
    const list = useList<{ id: string }>(loadPage, {
        perPage: 2,
    })
    return {
        ...list,
        ids: computed(() => list.items.value.map((item) => item.id)),
    }
}

describe('useList', () => {
    it('keeps the loaded rows quietly when a reload has no network', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 2))
            .mockRejectedValueOnce(
                Object.assign(new Error('offline'), { status: 0 }),
            )
        const list = createList()
        await list.refresh()
        await list.reloadLoaded()
        expect(list.ids.value).toEqual(['a', 'b'])
        expect(list.error.value).toBeNull()
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('loads the first page with the query options', async () => {
        loadPage.mockResolvedValue(pageOf(['a', 'b'], 3))
        const list = createList()
        await list.refresh()
        expect(loadPage).toHaveBeenCalledWith(1, 2)
        expect(list.ids.value).toEqual(['a', 'b'])
        expect(list.totalItems.value).toBe(3)
        expect(list.hasMore.value).toBe(true)
        expect(list.loading.value).toBe(false)
    })

    it('reloads every loaded row in one request without clearing the list', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 5))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 5))
            .mockResolvedValueOnce(pageOf(['new', 'a', 'b', 'c'], 6))
        const list = createList()
        await list.refresh()
        await list.loadMore()

        const reloading = list.reloadLoaded()
        expect(list.ids.value).toEqual(['a', 'b', 'c', 'd'])
        expect(list.loading.value).toBe(false)
        await reloading

        expect(loadPage).toHaveBeenLastCalledWith(1, 4)
        expect(list.ids.value).toEqual(['new', 'a', 'b', 'c'])
        expect(list.totalItems.value).toBe(6)
    })

    it('appends the next page and stops when exhausted', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 3))
            .mockResolvedValueOnce(pageOf(['c'], 3))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        expect(loadPage).toHaveBeenLastCalledWith(2, 2)
        expect(list.ids.value).toEqual(['a', 'b', 'c'])
        expect(list.hasMore.value).toBe(false)

        await list.loadMore()
        expect(loadPage).toHaveBeenCalledTimes(2)
    })

    it('skips rows already shown when a page overlaps after an insert', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['b', 'c'], 4))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 5))
        const list = createList()
        await list.refresh()
        list.items.value = [{ id: 'a' }, ...list.items.value]
        list.totalItems.value++
        await list.loadMore()
        expect(list.ids.value).toEqual(['a', 'b', 'c', 'd'])
    })

    it('reloads the shifted page after a removal so no row is skipped', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 5))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 5))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 4))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        list.items.value = list.items.value.filter((item) => item.id !== 'a')
        list.totalItems.value--
        await list.loadMore()
        expect(loadPage).toHaveBeenLastCalledWith(2, 2)
        expect(list.ids.value).toEqual(['b', 'c', 'd'])
    })

    it('stops loading when a page brings nothing new', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 5))
            .mockResolvedValueOnce(pageOf([], 5))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        expect(list.hasMore.value).toBe(false)
        await list.loadMore()
        expect(loadPage).toHaveBeenCalledTimes(2)
    })

    it('refresh resets to the first page', async () => {
        loadPage
            .mockResolvedValueOnce(pageOf(['a', 'b'], 3))
            .mockResolvedValueOnce(pageOf(['c'], 3))
            .mockResolvedValueOnce(pageOf(['x'], 1))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        await list.refresh()
        expect(loadPage).toHaveBeenLastCalledWith(1, 2)
        expect(list.ids.value).toEqual(['x'])
        expect(list.totalItems.value).toBe(1)
    })

    it('stores the error and notifies', async () => {
        const failure = new Error('down')
        loadPage.mockRejectedValue(failure)
        const list = createList()
        await list.refresh()
        expect(list.error.value).toBe(failure)
        expect(list.loading.value).toBe(false)
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })

    it('ignores aborted requests', async () => {
        loadPage.mockRejectedValue({ isAbort: true })
        const list = createList()
        await list.refresh()
        expect(list.error.value).toBeNull()
        expect(notifyError).not.toHaveBeenCalled()
    })

    it('lets only the newest request fill the list', async () => {
        const answers: ((page: ReturnType<typeof pageOf>) => void)[] = []
        loadPage.mockImplementation(
            () => new Promise((resolve) => answers.push(resolve)),
        )
        const list = createList()
        const older = list.refresh()
        const newer = list.refresh()
        answers[1]!(pageOf(['new'], 1))
        await newer
        answers[0]!(pageOf(['old'], 1))
        await older
        expect(list.ids.value).toEqual(['new'])
        expect(list.loading.value).toBe(false)
    })

    it('drops a page still loading when the list is refreshed', async () => {
        loadPage.mockResolvedValueOnce(pageOf(['a', 'b'], 4))
        const list = createList()
        await list.refresh()
        let answerMore!: (page: ReturnType<typeof pageOf>) => void
        loadPage.mockImplementationOnce(
            () => new Promise((resolve) => (answerMore = resolve)),
        )
        const more = list.loadMore()
        loadPage.mockResolvedValueOnce(pageOf(['x', 'y'], 4))
        await list.refresh()
        answerMore(pageOf(['c', 'd'], 4))
        await more
        expect(list.ids.value).toEqual(['x', 'y'])
        expect(list.loadingMore.value).toBe(false)
    })

    it('stops loading when a live reload overtakes a refresh', async () => {
        let answerRefresh!: (page: ReturnType<typeof pageOf>) => void
        loadPage.mockImplementationOnce(
            () => new Promise((resolve) => (answerRefresh = resolve)),
        )
        const list = createList()
        const refreshing = list.refresh()
        loadPage.mockResolvedValueOnce(pageOf(['a', 'b'], 2))
        await list.reloadLoaded()
        answerRefresh(pageOf(['x'], 1))
        await refreshing
        expect(list.ids.value).toEqual(['a', 'b'])
        expect(list.loading.value).toBe(false)
    })

    it('keeps loading while a live reload replaces a refresh', async () => {
        loadPage.mockImplementationOnce(() => new Promise(() => {}))
        const list = createList()
        void list.refresh()
        let answerReload!: (page: ReturnType<typeof pageOf>) => void
        loadPage.mockImplementationOnce(
            () => new Promise((resolve) => (answerReload = resolve)),
        )
        const reloading = list.reloadLoaded()
        expect(list.loading.value).toBe(true)
        answerReload(pageOf(['a'], 1))
        await reloading
        expect(list.loading.value).toBe(false)
    })

    it('loads no next page while a live reload runs', async () => {
        loadPage.mockResolvedValueOnce(pageOf(['a', 'b'], 4))
        const list = createList()
        await list.refresh()
        let answerReload!: (page: ReturnType<typeof pageOf>) => void
        loadPage.mockImplementationOnce(
            () => new Promise((resolve) => (answerReload = resolve)),
        )
        const reloading = list.reloadLoaded()
        await list.loadMore()
        answerReload(pageOf(['new', 'a'], 5))
        await reloading
        expect(loadPage).toHaveBeenCalledTimes(2)
        expect(list.ids.value).toEqual(['new', 'a'])
    })
})
