<script setup lang="ts">
import { listLocations, listRoutes, listWalls } from '~/api/routes'
import type { RouteRecord } from '~/types/models'
import { sanitizeGymMap } from '#shared/utils/mapGeometry'
import { cacheKeys } from '~/utils/realtimeCache'

const gymPath = useGymPath()

const gymId = useCurrentGymId()

const { data: unplaced } = useAsyncData(
    cacheKeys.unplacedRoutes,
    async () => {
        const [walls, locations] = await Promise.all([
            listWalls(
                gymId.value,
                {},
                { fields: 'location', requestKey: 'unplacedWalls' },
            ),
            listLocations(gymId.value, {
                fields: 'id,map',
                requestKey: 'unplacedLocations',
            }),
        ])
        const mapped = new Set(
            locations
                .filter((record) => sanitizeGymMap(record.map))
                .map((record) => record.id),
        )
        const locationIds = [
            ...new Set(
                walls
                    .map((wall) => wall.location)
                    .filter((id) => mapped.has(id)),
            ),
        ]
        if (!locationIds.length) return null
        const wanted = new Set(locationIds)
        const { items } = await listRoutes<RouteRecord>(
            gymId.value,
            { wall: 'none', sort: 'location' },
            { fields: 'location', requestKey: 'unplacedRoutes' },
        )
        const unplaced = items.filter((route) => wanted.has(route.location!))
        return unplaced.length
            ? { count: unplaced.length, location: unplaced[0]!.location }
            : null
    },
    { server: false, default: () => null },
)
</script>

<template>
    <UAlert
        v-if="unplaced"
        color="info"
        variant="soft"
        icon="i-lucide-map-pin"
        class="mb-4"
        data-testid="unplaced-banner"
    >
        <template #description>
            <div class="flex flex-wrap items-center gap-2">
                <span>{{
                    $t(
                        'mapPlacement.unplacedBanner',
                        { n: unplaced.count },
                        unplaced.count,
                    )
                }}</span>
                <div class="flex-1" />
                <UButton
                    size="sm"
                    color="info"
                    variant="soft"
                    :to="{
                        path: gymPath('/manage/map'),
                        query: { location: unplaced.location },
                    }"
                    data-testid="unplaced-banner-open"
                >
                    {{ $t('routes.mapPlacement') }}
                </UButton>
            </div>
        </template>
    </UAlert>
</template>
