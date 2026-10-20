<template>
    <section v-if="suggestions.length" data-testid="logbook-suggestions">
        <LayoutSectionHeader
            :title="$t('ticks.suggestions.title')"
            :subtitle="gym ? gymTitle(gym) : undefined"
        />
        <div class="grid grid-cols-12 gap-3">
            <div
                v-for="route in suggestions"
                :key="route.id"
                class="col-span-12 sm:col-span-6 lg:col-span-4"
            >
                <NuxtLink
                    :to="`/route?id=${route.id}`"
                    class="flex items-center gap-2 rounded-lg bg-elevated p-3 transition-colors hover:bg-accented"
                    data-testid="logbook-suggestion"
                >
                    <RouteSummary
                        :route="route"
                        :meta="
                            locationName(route) ||
                            (route.type
                                ? $t(`routes.types.${route.type.toLowerCase()}`)
                                : undefined)
                        "
                        class="flex-1"
                    >
                        <template v-if="isNew(route)" #markers>
                            <UBadge
                                size="sm"
                                color="primary"
                                variant="soft"
                                class="ml-1 shrink-0"
                            >
                                {{ $t('ticks.suggestions.new') }}
                            </UBadge>
                        </template>
                    </RouteSummary>
                    <UIcon
                        name="i-lucide-chevron-right"
                        class="size-4 shrink-0 text-muted"
                    />
                </NuxtLink>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { gymChangesTopic } from '#shared/utils/topics'
import { listRoutes } from '~/api/routes'
import { coalesce, removeById, type GymChange } from '~/utils/realtimeCache'
import type { RouteRecord } from '~/types/models'
import type { LogbookKind } from '#shared/utils/logbook'
import { locationName } from '#shared/utils/formatting'
import { gymTitle } from '~/utils/gymNames'
import { isNewRoute } from '~/utils/overview'

const SUGGESTION_COUNT = 6
const CANDIDATE_COUNT = 40

const props = defineProps<{
    kind: LogbookKind | null
    targetIndex: number | null
}>()

const { tickedRouteIds } = useTickedRoutes()

const gymId = useCurrentGymId()
const { gym } = useGym()

const { data: candidates, refresh: refreshCandidates } = useAsyncData(
    () => `logbook-suggestions-${gymId.value}-${props.kind ?? 'any'}`,
    () =>
        listRoutes<RouteRecord>(gymId.value, {
            ...(props.kind
                ? { type: props.kind === 'boulder' ? 'Boulder' : 'Route' }
                : {}),
            sort: '-created',
            include: ['location'],
            page: 1,
            limit: CANDIDATE_COUNT,
        })
            .then((page) => page.items)
            .catch(() => []),
    { default: () => [], enabled: () => !!gymId.value },
)

const refreshCandidatesSoon = coalesce(() => refreshCandidates(), 5000)
useRealtime(
    () => gymId.value && gymChangesTopic(gymId.value),
    ({ collection, action, record }: GymChange<RouteRecord>) => {
        if (collection !== 'routes') return
        if (action === 'create') return refreshCandidatesSoon()
        if (action === 'delete' || record.archived)
            candidates.value = removeById(candidates.value, record.id)
    },
    { resync: refreshCandidatesSoon },
)

const now = new Date()

function isNew(route: RouteRecord) {
    return isNewRoute(route, now)
}

const suggestions = computed(() => {
    const open = candidates.value.filter(
        (route) => !tickedRouteIds.value.has(route.id),
    )
    const target = props.targetIndex
    if (target === null) return open.slice(0, SUGGESTION_COUNT)
    const distance = (route: RouteRecord) =>
        typeof route.grade_index === 'number'
            ? Math.abs(route.grade_index - target)
            : Number.POSITIVE_INFINITY
    return [...open]
        .sort((a, b) => distance(a) - distance(b))
        .slice(0, SUGGESTION_COUNT)
})
</script>
