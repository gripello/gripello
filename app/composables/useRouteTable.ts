import { h, reactive, type Ref } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import { useTimeoutFn } from '@vueuse/core'
import { normalizeCreators } from '#shared/utils/formatting'
import { toSortParam, type SortOption } from '~/utils/sorting'
import type { RouteListItem, RouteRecord } from '~/types/models'

export interface RouteTableLoad {
    page?: number
    itemsPerPage?: number
    sortBy?: SortOption[]
}

export const routeTableUi = {
    th: 'px-2 last:pe-4 2xl:px-4',
    td: 'px-2 py-2 last:pe-4 2xl:px-4 whitespace-normal text-default',
}

export function toRouteRow(route: RouteRecord): RouteListItem {
    const hasRatings =
        Number(route.ratings_count ?? 0) > 0 &&
        typeof route.average_rating === 'number'
    return {
        ...route,
        comment: typeof route.comment === 'string' ? route.comment : '',
        creator: normalizeCreators(route.creator),
        score: hasRatings ? route.average_rating : null,
        has_ratings: hasRatings,
    }
}

export function useRouteTable({
    itemsPerPage,
    totalItems,
    queryKey,
    defaultSort,
    load,
}: {
    itemsPerPage: number
    totalItems: Ref<number>
    queryKey: Ref<string>
    defaultSort: string
    load: (options: RouteTableLoad) => unknown
}) {
    const { t } = useI18n()
    const tableOptions = reactive({
        page: 1,
        itemsPerPage,
        sortBy: [{ key: 'screw_date', order: 'desc' }] as SortOption[],
    })

    function sortableHeader(label: string, key: string) {
        return () => {
            const active = tableOptions.sortBy[0]
            const order = active?.key === key ? active.order : undefined
            return h(UButton, {
                color: 'neutral',
                variant: 'ghost',
                label,
                trailingIcon:
                    order === 'asc'
                        ? 'i-lucide-arrow-up'
                        : order === 'desc'
                          ? 'i-lucide-arrow-down'
                          : 'i-lucide-arrow-up-down',
                class: '-mx-2.5 w-[calc(100%+1.25rem)] font-semibold',
                onClick: () => toggleSort(key),
            })
        }
    }

    function toggleSort(key: string) {
        const active = tableOptions.sortBy[0]
        const sortBy: SortOption[] =
            active?.key !== key
                ? [{ key, order: 'asc' }]
                : active.order === 'asc'
                  ? [{ key, order: 'desc' }]
                  : []
        void load({ page: 1, sortBy })
    }

    const pageInfo = computed(() => {
        const { page, itemsPerPage } = tableOptions
        const start = totalItems.value ? (page - 1) * itemsPerPage + 1 : 0
        const end = Math.min(page * itemsPerPage, totalItems.value)
        return `${start}-${end} / ${totalItems.value}`
    })

    const sortItemsMobile = computed(() => [
        {
            title: t('routes.screwed_at'),
            key: 'screw_date',
            defaultOrder: 'desc' as const,
        },
        {
            title: t('ratings.score'),
            key: 'score',
            defaultOrder: 'desc' as const,
        },
        { title: t('climbing.routename'), key: 'name' },
        { title: t('climbing.difficulty'), key: 'difficulty' },
        { title: t('climbing.anchor_point'), key: 'anchor_point' },
    ])

    const onMobileSortChange = (sortBy: SortOption[]) =>
        void load({ page: 1, sortBy })

    const routeSort = () =>
        toSortParam(tableOptions.sortBy, defaultSort, {
            score: 'average_rating',
            difficulty: 'type,grade_index',
        })

    const { start: reloadSoon } = useTimeoutFn(
        () => void load({ page: 1 }),
        300,
        { immediate: false },
    )
    watch(queryKey, () => reloadSoon())

    return {
        tableOptions,
        tableUi: routeTableUi,
        sortableHeader,
        pageInfo,
        sortItemsMobile,
        onMobileSortChange,
        routeSort,
    }
}
