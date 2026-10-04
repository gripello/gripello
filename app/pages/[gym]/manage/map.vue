<template>
    <div class="map-screen placement-page">
        <div class="map-screen__bar">
            <h1 class="map-screen__title">{{ $t('mapPlacement.title') }}</h1>
            <USelect
                v-if="locationItems.length > 1"
                v-model="locationId"
                :items="locationItems"
                label-key="title"
                :aria-label="$t('climbing.location')"
                variant="soft"
                class="placement-location"
                data-testid="placement-location"
            />
            <UButton
                icon="i-lucide-undo-2"
                color="neutral"
                variant="ghost"
                :disabled="!placement.history.value.length"
                :aria-label="$t('mapEditor.undo')"
                :title="$t('mapEditor.undo')"
                data-testid="placement-undo"
                @click="placement.undo()"
            />
            <UPopover :content="{ align: 'end' }">
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    :aria-label="$t('mapPlacement.more')"
                    data-testid="placement-more"
                />
                <template #content="{ close }">
                    <div class="flex min-w-[200px] flex-col gap-0.5 p-1">
                        <UButton
                            icon="i-lucide-circle-x"
                            color="neutral"
                            variant="ghost"
                            :label="$t('mapPlacement.discard')"
                            :disabled="!placement.changes.value.length"
                            data-testid="placement-discard"
                            @click="runAndClose(close, discard)"
                        />
                        <UButton
                            v-if="can('manage_settings')"
                            icon="i-lucide-land-plot"
                            color="neutral"
                            variant="ghost"
                            :label="$t('routes.mapEditor')"
                            :to="gymPath(`/admin/map?location=${locationId}`)"
                        />
                    </div>
                </template>
            </UPopover>
            <UButton
                color="primary"
                variant="solid"
                icon="i-lucide-save"
                :disabled="!placement.changes.value.length"
                :loading="saving"
                data-testid="placement-save"
                @click="save"
            >
                {{
                    $t('mapPlacement.save', {
                        n: placement.changes.value.length,
                    })
                }}
            </UButton>
        </div>

        <div v-if="!map" class="placement-empty" data-testid="placement-empty">
            <LayoutEmptyState
                icon="i-lucide-map"
                :card="false"
                :title="$t('mapPlacement.noMap')"
            />
            <UButton
                v-if="can('manage_settings')"
                :to="gymPath('/admin/map')"
                color="neutral"
                variant="soft"
                icon="i-lucide-land-plot"
            >
                {{ $t('routes.mapEditor') }}
            </UButton>
        </div>

        <div v-else class="map-screen__body">
            <div class="map-screen__stage">
                <MapPlacementCanvas
                    ref="canvasRef"
                    :map="map"
                    :walls="mapWalls"
                    :routes="placement.effectiveRoutes.value"
                    :selected-route-id="placement.selectedRouteId.value"
                    :selected-wall-id="placement.selectedWallId.value"
                    :armed-route-id="placement.canvasArmedId.value"
                    :inset-bottom="sheetCover"
                    @place="placement.place"
                    @select-route="placement.selectedRouteId.value = $event"
                    @select-wall="selectWall"
                />
                <MapFilterChips
                    v-model:grade="placement.gradeFilter.value"
                    v-model:color="placement.colorFilter.value"
                    v-model:type="placement.typeFilter.value"
                    type-filter
                    class="map-screen__chips"
                    :grades="placement.gradeOptions.value"
                    :colors="placement.colorOptions.value"
                    :grade-label="$t('climbing.difficulty')"
                    :active-count="placement.activeFilterCount.value"
                    data-testid="placement-filters"
                    @clear="placement.clearFilters()"
                />
            </div>

            <MapSheet
                v-model:snap="sheetSnap"
                data-testid="placement-panel"
                @cover="sheetCover = $event"
            >
                <template #header>
                    <span
                        class="placement-hint text-xs"
                        aria-live="polite"
                        data-testid="placement-hint"
                    >
                        {{ hint }}
                    </span>
                    <UButton
                        v-if="placement.armedRouteId.value"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-skip-forward"
                        data-testid="placement-skip"
                        @click="placement.skipArmed()"
                    >
                        {{ $t('mapPlacement.skip') }}
                    </UButton>
                    <UButton
                        v-if="
                            placement.armedRouteId.value ||
                            placement.checkedIds.value.size
                        "
                        icon="i-lucide-x"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="$t('actions.cancel')"
                        data-testid="placement-cancel"
                        @click="placement.cancelArming()"
                    />
                    <template v-else-if="placement.selectedPlaced.value">
                        <UButton
                            icon="i-lucide-chevron-left"
                            color="neutral"
                            variant="soft"
                            size="sm"
                            :aria-label="$t('mapPlacement.nudgeBack')"
                            :title="$t('mapPlacement.nudgeBack')"
                            data-testid="placement-nudge-back"
                            @click="placement.nudge(-1)"
                        />
                        <UButton
                            icon="i-lucide-chevron-right"
                            color="neutral"
                            variant="soft"
                            size="sm"
                            :aria-label="$t('mapPlacement.nudgeForward')"
                            :title="$t('mapPlacement.nudgeForward')"
                            data-testid="placement-nudge-forward"
                            @click="placement.nudge(1)"
                        />
                        <UButton
                            icon="i-lucide-map-pin-x"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="$t('mapPlacement.remove')"
                            :title="$t('mapPlacement.remove')"
                            data-testid="placement-remove-selected"
                            @click="
                                placement.unplace(
                                    placement.selectedPlaced.value.id,
                                )
                            "
                        />
                    </template>
                </template>

                <div
                    v-if="placement.selectedWall.value"
                    class="placement-wall-box"
                    data-testid="placement-wall-box"
                >
                    <div class="flex items-center gap-2">
                        <p class="font-semibold grow">
                            {{ placement.selectedWall.value.name }}
                            <span class="text-muted font-normal">
                                ·
                                {{
                                    $t('mapPlacement.wallRoutes', {
                                        n: placement.wallRoutes.value.length,
                                    })
                                }}
                            </span>
                        </p>
                        <UButton
                            icon="i-lucide-x"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            :aria-label="$t('map.close')"
                            @click="selectWall(null)"
                        />
                    </div>
                    <p
                        v-if="placement.wallAge.value || lastReset"
                        class="text-xs text-muted mb-2"
                        data-testid="placement-wall-age"
                    >
                        <template v-if="placement.wallAge.value">
                            {{
                                $t('mapPlacement.wallAge', {
                                    oldest: placement.wallAge.value.oldest,
                                    average: placement.wallAge.value.average,
                                })
                            }}
                        </template>
                        <template v-if="lastReset">
                            <template v-if="placement.wallAge.value"
                                >·</template
                            >
                            {{
                                $t('mapPlacement.lastReset', {
                                    date: formatDate(lastReset, { locale }),
                                })
                            }}
                        </template>
                    </p>
                    <div class="flex flex-wrap gap-2">
                        <UButton
                            size="sm"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-between-horizontal-start"
                            :disabled="placement.wallRoutes.value.length < 2"
                            data-testid="placement-distribute"
                            @click="placement.distribute()"
                        >
                            {{ $t('mapPlacement.distribute') }}
                        </UButton>
                        <UButton
                            size="sm"
                            variant="ghost"
                            color="error"
                            icon="i-lucide-history"
                            :disabled="
                                !placement.savedWallRouteIds.value.length ||
                                placement.changes.value.length > 0
                            "
                            :title="
                                placement.changes.value.length
                                    ? $t('mapPlacement.resetNeedsSave')
                                    : undefined
                            "
                            data-testid="placement-reset-wall"
                            @click="resetDialogOpen = true"
                        >
                            {{ $t('mapPlacement.resetWall') }}
                        </UButton>
                    </div>
                </div>

                <div
                    v-if="placement.hasAnchorRanges.value"
                    class="placement-auto"
                >
                    <UButton
                        block
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-wand-sparkles"
                        :disabled="!placement.autoPlacements.value.size"
                        data-testid="placement-auto"
                        @click="placement.autoPlace()"
                    >
                        {{
                            $t('mapPlacement.auto', {
                                n: placement.autoPlacements.value.size,
                            })
                        }}
                    </UButton>
                </div>

                <div class="placement-tabs" role="tablist">
                    <button
                        v-for="tab in placementTabs"
                        :key="tab.value"
                        type="button"
                        role="tab"
                        class="placement-tab"
                        :class="{
                            'placement-tab--active':
                                placement.tab.value === tab.value,
                        }"
                        :aria-selected="placement.tab.value === tab.value"
                        :data-testid="`placement-tab-${tab.value}`"
                        @click="placement.tab.value = tab.value"
                    >
                        {{ tab.label }}
                    </button>
                </div>

                <div class="placement-tools">
                    <UInput
                        v-model="placement.search.value"
                        :placeholder="$t('climbing.searchRouteName')"
                        :aria-label="$t('climbing.searchRouteName')"
                        icon="i-lucide-search"
                        variant="soft"
                        class="placement-search"
                        data-testid="placement-search"
                    >
                        <template v-if="placement.search.value" #trailing>
                            <UButton
                                icon="i-lucide-x"
                                color="neutral"
                                variant="link"
                                size="sm"
                                :aria-label="$t('actions.clear')"
                                @click="placement.search.value = ''"
                            />
                        </template>
                    </UInput>
                    <USwitch
                        v-model="placement.keepGoing.value"
                        :label="$t('mapPlacement.keepGoing')"
                        class="shrink-0"
                        data-testid="placement-keep-going"
                    />
                </div>
                <div
                    v-if="placement.checkedIds.value.size"
                    class="placement-checked"
                    data-testid="placement-checked"
                >
                    <span class="text-sm">
                        {{
                            $t(
                                'mapPlacement.checked',
                                { n: placement.checkedIds.value.size },
                                placement.checkedIds.value.size,
                            )
                        }}
                    </span>
                    <UButton
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        @click="placement.cancelArming()"
                    >
                        {{ $t('actions.cancel') }}
                    </UButton>
                </div>

                <div class="placement-list">
                    <div
                        v-for="item in placement.listedRoutes.value"
                        :key="item.id"
                        class="placement-route"
                        :class="{
                            'placement-route--active':
                                item.id === placement.armedRouteId.value ||
                                item.id === placement.selectedRouteId.value,
                        }"
                        tabindex="0"
                        data-testid="placement-route"
                        :data-route-id="item.id"
                        @pointerdown="onItemPointerDown(item, $event)"
                        @contextmenu.prevent
                        @click="onListClick(item.id)"
                        @keydown.enter.self="onListClick(item.id)"
                    >
                        <UCheckbox
                            v-if="placement.tab.value === 'unplaced'"
                            :model-value="
                                placement.checkedIds.value.has(item.id)
                            "
                            class="mr-3"
                            :aria-label="item.name"
                            data-testid="placement-route-check"
                            @click.stop
                            @update:model-value="
                                placement.toggleChecked(item.id)
                            "
                        />
                        <RouteColorDot
                            :color="item.color"
                            :size="20"
                            class="mr-3"
                        />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm">{{
                                item.name
                            }}</span>
                            <span class="block truncate text-xs text-muted">
                                {{ routeSubtitle(item) }}
                            </span>
                        </span>
                        <UButton
                            v-if="item.wall"
                            icon="i-lucide-map-pin-x"
                            color="neutral"
                            variant="ghost"
                            :aria-label="$t('mapPlacement.remove')"
                            :title="$t('mapPlacement.remove')"
                            data-testid="placement-remove"
                            @click.stop="placement.unplace(item.id)"
                        />
                    </div>
                </div>
                <p
                    v-if="!placement.listedRoutes.value.length"
                    class="text-xs text-muted p-4"
                >
                    {{ $t('table.no_data') }}
                </p>
            </MapSheet>
        </div>

        <Teleport to="body">
            <div
                v-if="dragging"
                class="placement-drag-ghost"
                :style="{
                    left: `${dragging.x}px`,
                    top: `${dragging.y}px`,
                }"
                data-testid="placement-drag-ghost"
            >
                <RouteColorDot :color="dragging.color" :size="18" />
                <span>{{ dragging.name }}</span>
            </div>
        </Teleport>

        <ConfirmDialog
            v-model="resetDialogOpen"
            :title="$t('mapPlacement.resetWall')"
            :message="
                $t('mapPlacement.resetConfirm', {
                    n: placement.savedWallRouteIds.value.length,
                    wall: placement.selectedWall.value?.name ?? '',
                })
            "
            :confirm-text="$t('mapPlacement.resetWall')"
            :loading="resetting"
            data-testid="placement-reset-dialog"
            @confirm="resetWall"
        />

        <ConfirmDialog
            v-model="discardDialogOpen"
            :title="$t('account.unsavedChanges')"
            :message="$t('mapEditor.discard')"
            :confirm-text="$t('mapPlacement.discard')"
            @confirm="settleDiscard(true)"
        />
    </div>
</template>

<script setup lang="ts">
import type { RouteRecord } from '~/types/models'
import type { SheetSnap } from '~/components/map/Sheet.vue'
import { formatAnchorPoint, formatDate } from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import { cacheKeys } from '~/utils/realtimeCache'

const gymPath = useGymPath()

definePageMeta({
    middleware: 'auth',
    requiredPermission: 'manage_routes',
    footer: false,
})

const BATCH_SIZE = 150
const PLACEMENT_FIELDS =
    'id,name,color,grade,grade_system,grade_index,anchor_point,type,wall,wall_position,screw_date'
const DRAG_THRESHOLD_PX = 6
const LONG_PRESS_MS = 400

const { t, locale } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const { mdAndUp } = useDisplay()
const { can } = usePermissions()
const { success: notifySuccess } = useNotification()

useSeoMeta({ title: () => t('page.title.mapPlacement') })

const { discardDialogOpen, confirmDiscard, settleDiscard } = useDiscardConfirm(
    () => placement.changes.value.length > 0,
)

const { locationItems, locationId, map, walls, mapWalls } =
    await useGymMapLocation('placement', {
        confirmLeave: async () => {
            const confirmed = await confirmDiscard()
            if (confirmed) placement.reset()
            return confirmed
        },
    })

const { data: routes, refresh: refreshRoutes } = await useAsyncData(
    cacheKeys.placementRoutes,
    () =>
        locationId.value
            ? pb.collection('routes').getFullList<RouteRecord>({
                  filter: pb.filter('archived = false && location = {:id}', {
                      id: locationId.value,
                  }),
                  fields: PLACEMENT_FIELDS,
                  sort: 'anchor_point,name',
                  requestKey: 'placementRoutes',
              })
            : Promise.resolve([]),
    { watch: [locationId], default: () => [] },
)
useLiveLocation([cacheKeys.placementRoutes], locationId)

const placement = useMapPlacement(routes, walls, mapWalls)
const placementTabs = computed(() => [
    {
        value: 'unplaced' as const,
        label: t('mapPlacement.unplaced', {
            n: placement.unplacedRoutes.value.length,
        }),
    },
    {
        value: 'placed' as const,
        label: t('mapPlacement.placed', {
            n: placement.placedRoutes.value.length,
        }),
    },
])

const sheetSnap = ref<SheetSnap>('half')
const sheetCover = ref(0)

const { data: lastReset, refresh: refreshLastReset } = useAsyncData(
    'placement-wall-reset',
    () =>
        placement.selectedWallId.value
            ? pb
                  .collection('routes')
                  .getList<RouteRecord>(1, 1, {
                      filter: pb.filter('archived = true && wall = {:wall}', {
                          wall: placement.selectedWallId.value,
                      }),
                      sort: '-archived_at',
                      fields: 'archived_at',
                      skipTotal: true,
                      requestKey: 'placementWallReset',
                  })
                  .then((result) => result.items[0]?.archived_at ?? null)
            : Promise.resolve(null),
    {
        watch: [placement.selectedWallId],
        default: () => null,
        server: false,
    },
)

const hint = computed(() => {
    const checked = placement.checkedIds.value.size
    if (checked && !placement.armedRouteId.value)
        return t('mapPlacement.hints.checked', { n: checked }, checked)
    if (placement.armedRoute.value)
        return t('mapPlacement.hints.armed', {
            name: placement.armedRoute.value.name,
        })
    if (placement.selectedPlaced.value)
        return t('mapPlacement.hints.selected', {
            name: placement.selectedPlaced.value.name,
        })
    return t('mapPlacement.hints.idle')
})

function routeSubtitle(item: RouteRecord) {
    const grade = formatGrade(item)
    const anchor = formatAnchorPoint(item.anchor_point)
    return ['—', '-'].includes(String(anchor))
        ? grade
        : `${grade} · ${t('climbing.anchor_point')} ${anchor}`
}

function selectWall(wallId: string | null) {
    placement.selectedWallId.value = wallId
    if (wallId && !mdAndUp.value && sheetSnap.value === 'peek')
        sheetSnap.value = 'half'
}

function revealMap() {
    if (!mdAndUp.value) sheetSnap.value = 'peek'
}

watch(placement.canvasArmedId, (armedId) => {
    if (armedId) revealMap()
})

function runAndClose(close: () => void, action: () => unknown) {
    close()
    action()
}

async function discard() {
    if (await confirmDiscard()) placement.reset()
}

const canvasRef = useTemplateRef<{
    previewAt: (clientX: number, clientY: number) => void
    placeAt: (routeId: string, clientX: number, clientY: number) => boolean
}>('canvasRef')
const dragging = ref<{
    id: string
    name: string
    color?: string | null
    x: number
    y: number
} | null>(null)
let suppressClick = false

function onItemPointerDown(item: RouteRecord, event: PointerEvent) {
    if (event.button !== 0) return
    const isTouch = event.pointerType === 'touch'
    const start = { x: event.clientX, y: event.clientY }
    let longPressed = !isTouch
    let pressTimer = 0

    const startDrag = (x: number, y: number) => {
        dragging.value = {
            id: item.id,
            name: item.name,
            color: item.color,
            x,
            y,
        }
        canvasRef.value?.previewAt(x, y)
    }
    const preventScroll = (touchEvent: TouchEvent) => {
        if (dragging.value) touchEvent.preventDefault()
    }
    const cleanup = () => {
        clearTimeout(pressTimer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancel)
        window.removeEventListener('touchmove', preventScroll)
    }
    const move = (moveEvent: PointerEvent) => {
        const distance = Math.hypot(
            moveEvent.clientX - start.x,
            moveEvent.clientY - start.y,
        )
        if (!longPressed) {
            if (distance >= DRAG_THRESHOLD_PX) cleanup()
            return
        }
        if (!dragging.value && distance < DRAG_THRESHOLD_PX) return
        moveEvent.preventDefault()
        startDrag(moveEvent.clientX, moveEvent.clientY)
    }
    const end = (endEvent: PointerEvent) => {
        cleanup()
        if (!dragging.value) return
        suppressClick = true
        setTimeout(() => (suppressClick = false))
        canvasRef.value?.placeAt(item.id, endEvent.clientX, endEvent.clientY)
        dragging.value = null
    }
    const cancel = () => {
        cleanup()
        canvasRef.value?.previewAt(-1, -1)
        dragging.value = null
    }

    if (isTouch) {
        window.addEventListener('touchmove', preventScroll, { passive: false })
        pressTimer = window.setTimeout(() => {
            longPressed = true
            navigator.vibrate?.(10)
            revealMap()
            startDrag(start.x, start.y)
        }, LONG_PRESS_MS)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
}

function onListClick(routeId: string) {
    if (suppressClick) return
    placement.arm(routeId)
}

const { pending: saving, run: runSave } = useAsyncAction()

async function save() {
    const changes = placement.changes.value
    if (saving.value || !changes.length) return
    const saved = await runSave(
        async () => {
            for (let start = 0; start < changes.length; start += BATCH_SIZE) {
                const batch = pb.createBatch()
                for (const change of changes.slice(start, start + BATCH_SIZE))
                    batch.collection('routes').update(change.id, {
                        wall: change.wall,
                        wall_position: change.wall_position,
                    })
                await batch.send()
            }
            await refreshRoutes()
            placement.reset()
            return true
        },
        { success: t('mapPlacement.saved') },
    )
    if (!saved) await refreshRoutes()
}

const resetDialogOpen = ref(false)
const { pending: resetting, run: runReset } = useAsyncAction()

async function resetWall() {
    const wallId = placement.selectedWallId.value
    if (resetting.value || !wallId) return
    const archived = await runReset(async () => {
        const current = await pb.collection('routes').getFullList<RouteRecord>({
            filter: pb.filter('archived = false && wall = {:wall}', {
                wall: wallId,
            }),
            fields: 'id',
            requestKey: null,
        })
        const ids = current.map((item) => item.id)
        for (let start = 0; start < ids.length; start += BATCH_SIZE) {
            const batch = pb.createBatch()
            for (const id of ids.slice(start, start + BATCH_SIZE))
                batch.collection('routes').update(id, { archived: true })
            await batch.send()
        }
        await Promise.all([refreshRoutes(), refreshLastReset()])
        return ids.length
    })
    if (archived !== undefined)
        notifySuccess(t('mapPlacement.resetDone', { n: archived }, archived))
    resetDialogOpen.value = false
}

watch(
    routes,
    () => {
        const linked = route.query.route
        if (
            typeof linked === 'string' &&
            placement.unplacedRoutes.value.some((item) => item.id === linked)
        )
            placement.arm(linked)
    },
    { once: true, immediate: true },
)

onBeforeRouteLeave(() => confirmDiscard())

function onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
    const selected = placement.selectedPlaced.value
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        placement.undo()
        event.preventDefault()
    } else if (event.key === 'Escape') {
        placement.cancelArming()
    } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        selected
    ) {
        placement.nudge(event.key === 'ArrowLeft' ? -1 : 1)
        event.preventDefault()
    } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selected
    ) {
        placement.unplace(selected.id)
        event.preventDefault()
    }
}

function onBeforeUnload(event: BeforeUnloadEvent) {
    if (placement.changes.value.length) event.preventDefault()
}

onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.placement-location {
    flex: 0 1 200px;
    min-width: 0;
}

.placement-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 48px;
}

.placement-hint {
    flex: 1 1 auto;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--ui-text-muted);
}

.placement-wall-box {
    padding: 8px 8px 12px 16px;
    border-bottom: 1px solid var(--ui-border);
}

.placement-auto {
    padding: 8px 12px;
}

.placement-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 8px 12px 0;
}

.placement-search {
    flex: 1 1 180px;
}

.placement-tabs {
    display: flex;
    border-bottom: 1px solid var(--ui-border);
}

.placement-tab {
    flex: 1 1 auto;
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--ui-text-muted);
    border-bottom: 2px solid transparent;
}

.placement-tab--active {
    color: var(--ui-primary);
    border-bottom-color: var(--ui-primary);
}

.placement-route:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.placement-route:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

.placement-route--active {
    color: var(--ui-primary);
    background: color-mix(in oklab, var(--ui-primary) 12%, transparent);
}

.placement-checked {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding: 4px 12px 4px 16px;
    background: color-mix(in oklab, var(--ui-primary) 8%, transparent);
}

.placement-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px 0;
}

.placement-route {
    display: flex;
    align-items: center;
    min-height: 48px;
    padding: 4px 4px 4px 8px;
    border-radius: 8px;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.placement-drag-ghost {
    position: fixed;
    z-index: 3000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--ui-bg);
    color: var(--ui-text-highlighted);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    font-size: 0.8125rem;
    pointer-events: none;
    transform: translate(12px, 12px);
}

@variant max-sm {
    .map-screen__title {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }

    .placement-location {
        flex: 1 1 auto;
    }

    .placement-page .map-screen__bar {
        justify-content: flex-end;
    }
}
</style>
