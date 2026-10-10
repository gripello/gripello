import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { usePbList } from '~/composables/usePbList'

const notifyError = vi.fn()
vi.stubGlobal('useNotification', () => ({ error: notifyError }))

const getList = vi.fn()

function pageOf(ids: string[], totalItems: number) {
    return { items: ids.map((id) => ({ id })), total: totalItems }
}

beforeEach(() => {
    getList.mockReset()
    notifyError.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

function createList() {
    const list = usePbList<{ id: string }>(getList, {
        perPage: 2,
        requestKey: 'thingsList',
    })
    return {
        ...list,
        ids: computed(() => list.items.value.map((item) => item.id)),
    }
}

describe('usePbList', () => {
    it('loads the first page with the query options', async () => {
        getList.mockResolvedValue(pageOf(['a', 'b'], 3))
        const list = createList()
        await list.refresh()
        expect(getList).toHaveBeenCalledWith(1, 2)
        expect(list.ids.value).toEqual(['a', 'b'])
        expect(list.totalItems.value).toBe(3)
        expect(list.hasMore.value).toBe(true)
        expect(list.loading.value).toBe(false)
    })

    it('reloads every loaded row in one request without clearing the list', async () => {
        getList
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

        expect(getList).toHaveBeenLastCalledWith(1, 4)
        expect(list.ids.value).toEqual(['new', 'a', 'b', 'c'])
        expect(list.totalItems.value).toBe(6)
    })

    it('appends the next page and stops when exhausted', async () => {
        getList
            .mockResolvedValueOnce(pageOf(['a', 'b'], 3))
            .mockResolvedValueOnce(pageOf(['c'], 3))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        expect(getList).toHaveBeenLastCalledWith(2, 2)
        expect(list.ids.value).toEqual(['a', 'b', 'c'])
        expect(list.hasMore.value).toBe(false)

        await list.loadMore()
        expect(getList).toHaveBeenCalledTimes(2)
    })

    it('skips rows already shown when a page overlaps after an insert', async () => {
        getList
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
        getList
            .mockResolvedValueOnce(pageOf(['a', 'b'], 5))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 5))
            .mockResolvedValueOnce(pageOf(['c', 'd'], 4))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        list.items.value = list.items.value.filter((item) => item.id !== 'a')
        list.totalItems.value--
        await list.loadMore()
        expect(getList).toHaveBeenLastCalledWith(2, 2)
        expect(list.ids.value).toEqual(['b', 'c', 'd'])
    })

    it('stops loading when a page brings nothing new', async () => {
        getList
            .mockResolvedValueOnce(pageOf(['a', 'b'], 5))
            .mockResolvedValueOnce(pageOf([], 5))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        expect(list.hasMore.value).toBe(false)
        await list.loadMore()
        expect(getList).toHaveBeenCalledTimes(2)
    })

    it('refresh resets to the first page', async () => {
        getList
            .mockResolvedValueOnce(pageOf(['a', 'b'], 3))
            .mockResolvedValueOnce(pageOf(['c'], 3))
            .mockResolvedValueOnce(pageOf(['x'], 1))
        const list = createList()
        await list.refresh()
        await list.loadMore()
        await list.refresh()
        expect(getList).toHaveBeenLastCalledWith(1, 2)
        expect(list.ids.value).toEqual(['x'])
        expect(list.totalItems.value).toBe(1)
    })

    it('stores the error and notifies', async () => {
        const failure = new Error('down')
        getList.mockRejectedValue(failure)
        const list = createList()
        await list.refresh()
        expect(list.error.value).toBe(failure)
        expect(list.loading.value).toBe(false)
        expect(notifyError).toHaveBeenCalledWith('notifications.error.generic')
    })

    it('ignores aborted requests', async () => {
        getList.mockRejectedValue({ isAbort: true })
        const list = createList()
        await list.refresh()
        expect(list.error.value).toBeNull()
        expect(notifyError).not.toHaveBeenCalled()
    })
})
