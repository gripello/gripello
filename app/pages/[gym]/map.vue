<template>
    <div class="map-screen" data-testid="map-page">
        <h1 class="sr-only">{{ $t('map.title') }}</h1>

        <div class="map-screen__body">
            <div class="map-screen__stage">
                <div v-if="loadFailed" class="map-empty">
                    <LayoutEmptyState
                        variant="error"
                        :card="false"
                        :title="$t('errors.loadFailed')"
                        data-testid="load-error"
                    >
                        <template #actions>
                            <UButton
                                color="neutral"
                                variant="soft"
                                icon="i-lucide-refresh-cw"
                                data-testid="load-error-retry"
                                @click="retryLoad"
                            >
                                {{ $t('errors.retry') }}
                            </UButton>
                        </template>
                    </LayoutEmptyState>
                </div>
                <MapView
                    v-else-if="map"
                    ref="mapViewRef"
                    :map="map"
                    :walls="walls"
                    :routes="routes"
                    :layout-routes="allRoutes"
                    :sent-ids="isLoggedIn ? tickedRouteIds : null"
                    :defects="defectsByRoute"
                    :matching-ids="matchingIds"
                    :show-sent="isLoggedIn"
                    :selected-wall-id="selectedWallId"
                    :selected-route-id="selectedRouteId"
                    :inset-bottom="sheetCover"
                    @select-wall="selectWall"
                    @select-route="selectRoute"
                />
                <div v-else class="map-empty" data-testid="map-empty">
                    <LayoutEmptyState
                        icon="i-lucide-map"
                        :card="false"
                        :title="$t('map.noMap')"
                    />
                    <UButton
                        :to="gymPath('/routes')"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-list"
                    >
                        {{ $t('map.openList') }}
                    </UButton>
                </div>

                <MapFilterChips
                    v-if="map"
                    v-model:grade="gradeFilter"
                    v-model:color="colorFilter"
                    v-model:type="mapType"
                    type-filter
                    class="map-screen__chips"
                    :grades="gradeItems"
                    :colors="colorOptions"
                    :grade-label="gradeColumnTitle"
                    :active-count="activeCount"
                    @clear="resetFilters"
                >
                    <UDropdownMenu
                        v-if="locationItems.length > 1"
                        :items="locationMenuItems"
                        :content="{ align: 'start' }"
                    >
                        <UButton
                            class="map-chip rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
                            color="neutral"
                            variant="outline"
                            icon="i-lucide-map-pin"
                            trailing-icon="i-lucide-chevron-down"
                            data-testid="map-location"
                        >
                            {{ location?.name }}
                        </UButton>
                    </UDropdownMenu>
                    <template v-if="isLoggedIn" #after-type>
                        <UButton
                            v-for="option in sentOptions"
                            :key="option.value"
                            class="map-chip rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
                            :color="
                                sentFilter === option.value
                                    ? 'primary'
                                    : 'neutral'
                            "
                            :variant="
                                sentFilter === option.value
                                    ? 'solid'
                                    : 'outline'
                            "
                            :aria-pressed="sentFilter === option.value"
                            :data-testid="`map-filter-${option.value}`"
                            @click="toggleSent(option.value)"
                        >
                            {{ option.label }}
                        </UButton>
                    </template>
                </MapFilterChips>
            </div>

            <MapSheet
                v-if="map"
                v-model:snap="sheetSnap"
                data-testid="map-list"
                @cover="sheetCover = $event"
            >
                <template #header>
                    <UButton
                        v-if="selectedRoute"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-arrow-left"
                        data-testid="map-route-card-close"
                        @click="selectRoute(null)"
                    >
                        {{ $t('map.backToList') }}
                    </UButton>
                    <template v-else>
                        <span
                            class="truncate font-semibold"
                            data-testid="map-list-title"
                            >{{ listTitle }} · {{ listCount }}</span
                        >
                        <div class="flex-1" />
                        <UButton
                            v-if="selectedWall && isLoggedIn"
                            color="neutral"
                            :variant="followingWall ? 'soft' : 'ghost'"
                            :icon="
                                followingWall
                                    ? 'i-lucide-bell-ring'
                                    : 'i-lucide-bell-plus'
                            "
                            class="icon-btn"
                            :aria-label="
                                $t(
                                    followingWall
                                        ? 'map.unfollowWall'
                                        : 'map.followWall',
                                    { wall: selectedWall.name },
                                )
                            "
                            :aria-pressed="followingWall"
                            data-testid="map-follow-wall"
                            @click="toggleFollowWall"
                        />
                        <UButton
                            v-if="selectedWallId"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            data-testid="map-list-all"
                            @click="selectWall(null)"
                        >
                            {{ $t('map.allWalls') }}
                        </UButton>
                    </template>
                </template>

                <div
                    v-if="selectedRoute"
                    class="map-screen__route"
                    data-testid="map-route-card"
                >
                    <RouteCard
                        :route="selectedRoute"
                        :ticked="tickedRouteIds.has(selectedRoute.id)"
                        :defect="defectsByRoute.get(selectedRoute.id)"
                    >
                        <template #actions>
                            <UButton
                                v-if="isLoggedIn"
                                color="neutral"
                                variant="soft"
                                icon="i-lucide-circle-check"
                                data-testid="map-log-ascent"
                                @click="openTick(selectedRoute.id)"
                            >
                                {{ $t('ticks.logAscent') }}
                            </UButton>
                            <RouteViewButton
                                :route-id="selectedRoute.id"
                                compact
                            />
                        </template>
                    </RouteCard>
                </div>
                <template v-else>
                    <div class="map-screen__search">
                        <UInput
                            v-model="searchRouteName"
                            :placeholder="$t('climbing.searchRouteName')"
                            :aria-label="$t('climbing.searchRouteName')"
                            icon="i-lucide-search"
                            variant="soft"
                            size="lg"
                            class="w-full"
                            data-testid="map-filter-search"
                            @focus="sheetSnap = 'full'"
                        >
                            <template v-if="searchRouteName" #trailing>
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="link"
                                    size="sm"
                                    :aria-label="$t('actions.clear')"
                                    @click="searchRouteName = ''"
                                />
                            </template>
                        </UInput>
                    </div>
                    <MapRouteList
                        class="map-screen__list"
                        :groups="listGroups"
                        :show-headings="!selectedWallId"
                        :ticked-ids="tickedRouteIds"
                        :defects="defectsByRoute"
                        :selected-route-id="selectedRouteId"
                        @select="onListSelect"
                    />
                </template>
            </MapSheet>
        </div>

        <TickDialog
            v-if="isLoggedIn"
            v-model="tickOpen"
            :route-id="tickRouteId"
            @saved="refreshTickedRoutes()"
        />
    </div>
</template>

<script setup lang="ts">
import type { RouteListItem, RouteScoreRecord } from '~/types/models'
import type { SheetSnap } from '~/components/map/Sheet.vue'
import type { RouteTypeFilter } from '~/components/map/FilterChips.vue'
import { normalizeCreators } from '#shared/utils/formatting'
import { routesOnWall } from '~/utils/gymMap'
import { toHex6 } from '~/utils/color'
import { cacheKeys } from '~/utils/realtimeCache'

const gymPath = useGymPath()

definePageMeta({ keepalive: true })

const MAP_ROUTE_FIELDS =
    'id,name,color,grade,grade_system,grade_index,anchor_point,location,type,comment,creator,screw_date,wall,wall_position,average_rating,ratings_count'
const TYPE_STORAGE_KEY = 'map-route-type'

const { t } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const router = useRouter()
const { polite: announce } = useAnnouncer()
const { mdAndUp } = useDisplay()
const isLoggedIn = computed(() => pb.authStore.isValid)
const { tickedRouteIds, refreshTickedRoutes } = useTickedRoutes()
const { defectsByRoute } = useOpenDefects()
const { gradeColumnTitle } = useGradeSystems()
const {
    searchRouteName,
    selectedDifficulty,
    difficulties,
    pbFilter,
    clearFilters,
} = useRouteFilters()
const mapType = ref<RouteTypeFilter>('')

useSeoMeta({
    title: () => t('page.title.map'),
    description: () => t('map.description'),
})

const {
    locationItems,
    locationId,
    location,
    map,
    walls,
    wallsError,
    refreshWalls,
    mapWalls,
} = await useGymMapLocation('map')

const {
    data: routeRecords,
    error: routesError,
    refresh: refreshRoutes,
} = await useAsyncData(
    cacheKeys.mapRoutes,
    () =>
        locationId.value
            ? pb.collection('averageRating').getFullList<RouteScoreRecord>({
                  filter: pb.filter('archived = false && location = {:id}', {
                      id: locationId.value,
                  }),
                  fields: MAP_ROUTE_FIELDS,
                  requestKey: 'mapRoutes',
              })
            : Promise.resolve([]),
    { watch: [locationId], default: () => [] },
)

useLiveLocation([cacheKeys.mapRoutes], locationId)

const locationMenuItems = computed(() =>
    locationItems.value.map((item) => ({
        label: item.title,
        type: 'checkbox' as const,
        checked: item.value === locationId.value,
        onSelect: () => {
            locationId.value = item.value
        },
    })),
)

const loadFailed = computed(() => !!routesError.value || !!wallsError.value)

function retryLoad() {
    return Promise.all([refreshRoutes(), refreshWalls()])
}

const allRoutes = computed<RouteListItem[]>(() =>
    routeRecords.value.map((record) => {
        const hasRatings =
            Number(record.ratings_count ?? 0) > 0 &&
            typeof record.average_rating === 'number'
        return {
            ...record,
            creator: normalizeCreators(record.creator),
            has_ratings: hasRatings,
            score: hasRatings ? record.average_rating : undefined,
        }
    }),
)
const routes = computed(() =>
    mapType.value
        ? allRoutes.value.filter((item) => item.type === mapType.value)
        : allRoutes.value,
)

const sentFilter = ref<'all' | 'sent' | 'unsent'>('all')
const colorFilter = ref<string | null>(null)
const colorOptions = computed(() => [
    ...new Set(routes.value.map((item) => toHex6(item.color)).filter(Boolean)),
])
const gradeItems = computed(() =>
    difficulties.value
        .filter((item) => item.value)
        .map((item) => ({ title: item.text, value: String(item.value) })),
)
const gradeFilter = computed({
    get: () => selectedDifficulty.value || null,
    set: (value: string | null) => (selectedDifficulty.value = value ?? ''),
})

const { data: serverMatches } = useAsyncData(
    'map-matching',
    () =>
        locationId.value && pbFilter.value
            ? pb.collection('averageRating').getFullList<{ id: string }>({
                  filter: `archived = false && location = "${locationId.value}" && (${pbFilter.value})`,
                  fields: 'id',
                  requestKey: 'mapMatching',
              })
            : Promise.resolve(null),
    { watch: [pbFilter, locationId], server: false, default: () => null },
)

const matchingIds = computed<Set<string> | null>(() => {
    const hasServerFilter = !!pbFilter.value
    const hasSentFilter = isLoggedIn.value && sentFilter.value !== 'all'
    if (!hasServerFilter && !hasSentFilter && !colorFilter.value) return null
    const serverIds = hasServerFilter
        ? new Set((serverMatches.value ?? []).map((match) => match.id))
        : null
    return new Set(
        routes.value
            .filter((item) => !serverIds || serverIds.has(item.id))
            .filter(
                (item) =>
                    !colorFilter.value ||
                    toHex6(item.color) === colorFilter.value,
            )
            .filter(
                (item) =>
                    !hasSentFilter ||
                    tickedRouteIds.value.has(item.id) ===
                        (sentFilter.value === 'sent'),
            )
            .map((item) => item.id),
    )
})

const matchingRoutes = computed(() =>
    matchingIds.value
        ? routes.value.filter((item) => matchingIds.value!.has(item.id))
        : routes.value,
)
const matchingCount = computed(() => matchingRoutes.value.length)
const activeCount = computed(
    () =>
        [
            searchRouteName.value,
            selectedDifficulty.value,
            isLoggedIn.value && sentFilter.value !== 'all',
            colorFilter.value,
            mapType.value,
        ].filter(Boolean).length,
)

watch(matchingCount, (count) => {
    if (matchingIds.value) announce(t('climbing.routesFound', { n: count }))
})

const sentOptions = computed(() => [
    { value: 'unsent' as const, label: t('map.unsent') },
    { value: 'sent' as const, label: t('ticks.sent') },
])

function toggleSent(value: 'sent' | 'unsent') {
    sentFilter.value = sentFilter.value === value ? 'all' : value
}

const selectedWallId = computed(() => (route.query.wall as string) || null)
const selectedRouteId = computed(() => (route.query.route as string) || null)
const selectedRoute = computed(
    () =>
        allRoutes.value.find((item) => item.id === selectedRouteId.value) ??
        null,
)
const mapViewRef = useTemplateRef<{
    focusWall: (id: string) => void
    focusRoute: (id: string) => void
    fitAll: (animate?: boolean) => void
}>('mapViewRef')

const sheetSnap = ref<SheetSnap>('peek')
const sheetCover = ref(0)

function setQuery(patch: Record<string, string | null>) {
    const query = { ...route.query, ...patch }
    for (const key of Object.keys(patch)) if (!patch[key]) delete query[key]
    void router.replace({ query })
}

function selectWall(wallId: string | null) {
    setQuery({ wall: wallId, route: null })
    if (wallId) mapViewRef.value?.focusWall(wallId)
}

function selectRoute(routeId: string | null) {
    setQuery({ route: routeId })
    if (routeId && !mdAndUp.value && sheetSnap.value === 'peek')
        sheetSnap.value = 'half'
}

function onListSelect(routeId: string) {
    if (!mdAndUp.value) sheetSnap.value = 'half'
    selectRoute(routeId)
    const item = allRoutes.value.find((candidate) => candidate.id === routeId)
    if (item?.wall && mapWalls.value.some((wall) => wall.id === item.wall))
        nextTick(() => mapViewRef.value?.focusRoute(routeId))
}

const selectedWall = computed(() =>
    mapWalls.value.find((wall) => wall.id === selectedWallId.value),
)
const { isFollowing, setFollowing } = useFollowedWalls()
const { error: notifyError } = useNotification()
const followingWall = computed(
    () => !!selectedWall.value && isFollowing(selectedWall.value.id),
)
async function toggleFollowWall() {
    if (!selectedWall.value) return
    await setFollowing(selectedWall.value.id, !followingWall.value).catch(() =>
        notifyError(t('notifications.error.edit')),
    )
}
const listTitle = computed(() =>
    selectedWall.value ? selectedWall.value.name : t('map.allRoutes'),
)
const listCount = computed(() =>
    listGroups.value.reduce((sum, group) => sum + group.routes.length, 0),
)

const listGroups = computed(() => {
    if (selectedWall.value)
        return [
            {
                id: selectedWall.value.id,
                name: selectedWall.value.name,
                routes: routesOnWall(
                    matchingRoutes.value,
                    selectedWall.value.id,
                ),
            },
        ].filter((group) => group.routes.length)
    const groups = mapWalls.value.map((wall) => ({
        id: wall.id,
        name: wall.name,
        routes: routesOnWall(matchingRoutes.value, wall.id),
    }))
    const wallIds = new Set(mapWalls.value.map((wall) => wall.id))
    groups.push({
        id: 'unplaced',
        name: t('map.notOnMap'),
        routes: matchingRoutes.value.filter(
            (item) => !item.wall || !wallIds.has(item.wall),
        ),
    })
    return groups.filter((group) => group.routes.length)
})

watch(mapType, (type) => {
    try {
        localStorage.setItem(TYPE_STORAGE_KEY, type)
    } catch {}
})

function resetFilters() {
    clearFilters()
    sentFilter.value = 'all'
    colorFilter.value = null
    mapType.value = ''
}

const tickOpen = ref(false)
const tickRouteId = ref<string | null>(null)

function openTick(routeId: string) {
    tickRouteId.value = routeId
    tickOpen.value = true
}

function restoreMapType() {
    try {
        const stored = localStorage.getItem(TYPE_STORAGE_KEY)
        if (stored === 'Boulder' || stored === 'Route') mapType.value = stored
    } catch {}
}

onMounted(async () => {
    restoreMapType()
    if (selectedRouteId.value && !mdAndUp.value) sheetSnap.value = 'half'
    await nextTick()
    if (selectedRouteId.value)
        mapViewRef.value?.focusRoute(selectedRouteId.value)
    else if (selectedWallId.value)
        mapViewRef.value?.focusWall(selectedWallId.value)
})
</script>

<style scoped>
.map-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 48px;
}

.map-screen__search {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 4px 12px 8px;
    background: var(--ui-bg);
}

.map-screen__list {
    padding: 0 8px 12px;
}

.map-screen__route {
    padding: 0 12px 16px;
}
</style>
