<template>
    <section v-if="suggestions.length" data-testid="logbook-suggestions">
        <LayoutSectionHeader
            :title="$t('ticks.suggestions.title')"
            :subtitle="
                targetIndex === null
                    ? $t('ticks.suggestions.subtitleNew')
                    : $t('ticks.suggestions.subtitle')
            "
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
import { listRoutes } from '~/api/routes'
import type { RouteRecord } from '~/types/models'
import type { LogbookKind } from '#shared/utils/logbook'
import { locationName } from '#shared/utils/formatting'

const SUGGESTION_COUNT = 6
const CANDIDATE_COUNT = 40
const NEW_ROUTE_DAYS = 30

const props = defineProps<{
    kind: LogbookKind | null
    targetIndex: number | null
}>()

const { tickedRouteIds } = useTickedRoutes()

const gymId = useCurrentGymId()

const { data: candidates } = useAsyncData(
    () => `logbook-suggestions-${gymId.value}-${props.kind ?? 'any'}`,
    () =>
        listRoutes<RouteRecord>(
            gymId.value,
            {
                ...(props.kind
                    ? { type: props.kind === 'boulder' ? 'Boulder' : 'Route' }
                    : {}),
                sort: '-created',
                include: ['location'],
                page: 1,
                limit: CANDIDATE_COUNT,
            },
            { requestKey: null },
        )
            .then((page) => page.items)
            .catch(() => []),
    { default: () => [], enabled: () => !!gymId.value },
)

const newSince = Date.now() - NEW_ROUTE_DAYS * 86_400_000

function isNew(route: RouteRecord) {
    return !!route.created && new Date(route.created).getTime() > newSince
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
