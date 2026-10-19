import type { Ref } from 'vue'
import { isAbortError } from '~/utils/errors'
import { isOfflineError } from '~/utils/tickOutbox'

export type ListFetch<TRecord> = (
    page: number,
    perPage: number,
) => Promise<{ items: TRecord[]; total?: number }>

interface ListOptions<TRecord, TItem> {
    perPage: number
    requestKey: string
    map?: (record: TRecord) => TItem
}

export function useList<
    TRecord,
    TItem extends { id: string } = TRecord & { id: string },
>(load: ListFetch<TRecord>, options: ListOptions<TRecord, TItem>) {
    const { t } = useI18n()
    const { error: notifyError } = useNotification()

    const items = ref([]) as Ref<TItem[]>
    const totalItems = ref(0)
    const loading = ref(false)
    const loadingMore = ref(false)
    const reloading = ref(false)
    const error = ref<unknown>(null)
    const exhausted = ref(false)
    const hasMore = computed(
        () => !exhausted.value && items.value.length < totalItems.value,
    )

    let latestRequest = 0

    const toItem = (record: TRecord) =>
        options.map ? options.map(record) : (record as unknown as TItem)

    async function fetchPage(
        target: number,
        busy: Ref<boolean>,
        perPage = options.perPage,
    ) {
        const request = ++latestRequest
        loadingMore.value = false
        busy.value = true
        error.value = null
        try {
            const result = await load(target, perPage)
            if (request !== latestRequest) return
            const mapped = result.items.map(toItem)
            const loadedIds = new Set(items.value.map((item) => item.id))
            const unseen = mapped.filter((item) => !loadedIds.has(item.id))
            items.value = target === 1 ? mapped : [...items.value, ...unseen]
            exhausted.value = target !== 1 && unseen.length === 0
            totalItems.value = result.total ?? 0
        } catch (err) {
            if (request !== latestRequest || isAbortError(err)) return
            if (target === 1 && items.value.length && isOfflineError(err))
                return
            error.value = err
            console.error(`Failed to fetch ${options.requestKey}:`, err)
            notifyError(t('notifications.error.generic'))
        } finally {
            if (request === latestRequest) busy.value = false
        }
    }

    function refresh() {
        items.value = []
        return fetchPage(1, loading)
    }

    function reloadLoaded() {
        return fetchPage(
            1,
            loading.value ? loading : reloading,
            Math.max(items.value.length, options.perPage),
        )
    }

    async function loadMore() {
        if (
            loading.value ||
            loadingMore.value ||
            reloading.value ||
            !hasMore.value
        )
            return
        const nextPage = Math.floor(items.value.length / options.perPage) + 1
        await fetchPage(nextPage, loadingMore)
    }

    async function prefetch(key: string) {
        const request = useAsyncData(key, async () => {
            await refresh()
            return { items: items.value, totalItems: totalItems.value }
        })
        const adopt = () => {
            if (!request.data.value) return
            items.value = request.data.value.items as TItem[]
            totalItems.value = request.data.value.totalItems
        }
        adopt()
        await request
        adopt()
    }

    return {
        items,
        totalItems,
        loading,
        loadingMore,
        hasMore,
        error,
        refresh,
        reloadLoaded,
        loadMore,
        prefetch,
    }
}
