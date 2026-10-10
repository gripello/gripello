<template>
    <div class="inventory-page p-0">
        <div class="inventory-layout">
            <div
                class="inventory-layout__controls"
                data-testid="inventory-controls"
            >
                <div
                    v-if="cameraActive"
                    ref="viewportRef"
                    class="scanner-viewport"
                    data-testid="scanner-viewport"
                >
                    <QrStream
                        :formats="['QRCode']"
                        :constraints="cameraConstraints"
                        :tag="codeTag"
                        @detect="onDetect"
                        @camera-on="onCameraOn"
                        @error="onCameraError"
                    />
                    <UButton
                        v-if="scanning && torchSupported"
                        class="scanner-viewport__torch icon-btn"
                        :icon="
                            torchOn
                                ? 'i-lucide-flashlight'
                                : 'i-lucide-flashlight-off'
                        "
                        :color="torchOn ? 'warning' : 'neutral'"
                        variant="solid"
                        :aria-label="$t('inventory.toggleTorch')"
                        data-testid="inventory-torch"
                        @click="toggleTorch"
                    />
                </div>

                <div class="px-4 pt-3">
                    <LayoutPageHeader
                        :title="$t('inventory.title')"
                        inline-actions
                    >
                        <template #actions>
                            <UButton
                                class="icon-btn"
                                icon="i-lucide-refresh-cw"
                                color="neutral"
                                variant="ghost"
                                :disabled="
                                    scannedRouteIds.length === 0 && !scanning
                                "
                                :aria-label="$t('inventory.reset')"
                                data-testid="inventory-reset"
                                @click="resetDialog = true"
                            />
                            <UButton
                                class="icon-btn"
                                icon="i-lucide-info"
                                color="neutral"
                                variant="ghost"
                                :aria-label="$t('inventory.showInstructions')"
                                @click="instructionsDialog = true"
                            />
                        </template>
                    </LayoutPageHeader>

                    <div class="flex flex-wrap items-center gap-3">
                        <div
                            v-if="!locationLocked"
                            class="inventory-locations flex gap-1"
                            role="group"
                            :aria-label="$t('inventory.locationLabel')"
                            data-testid="inventory-location"
                        >
                            <UButton
                                v-for="item in locationItems"
                                :key="item.value"
                                size="sm"
                                :variant="
                                    sessionLocation === item.value
                                        ? 'solid'
                                        : 'outline'
                                "
                                :color="
                                    sessionLocation === item.value
                                        ? 'primary'
                                        : 'neutral'
                                "
                                :aria-pressed="sessionLocation === item.value"
                                :data-testid="`inventory-location-${item.title}`"
                                @click="sessionLocation = item.value"
                            >
                                {{ item.title }}
                            </UButton>
                        </div>
                        <UButton
                            v-else
                            size="sm"
                            color="primary"
                            variant="soft"
                            trailing-icon="i-lucide-x"
                            :aria-label="$t('inventory.changeLocation')"
                            data-testid="inventory-change-location"
                            @click="resetDialog = true"
                        >
                            {{ sessionLocationName }}
                        </UButton>

                        <div class="progress-group flex items-center gap-2">
                            <UProgress
                                :model-value="progress"
                                color="success"
                                size="sm"
                                class="grow"
                            />
                            <span
                                class="text-xs text-muted shrink-0"
                                data-testid="inventory-progress"
                            >
                                {{ foundRoutes.length }}/{{ scoped.length }}
                            </span>
                        </div>
                    </div>

                    <p
                        v-if="!sessionLocation"
                        class="text-xs text-muted mt-2 mb-0"
                    >
                        {{
                            restoredUnscoped
                                ? $t('inventory.locationRestoreHint')
                                : $t('inventory.locationHint')
                        }}
                    </p>
                </div>

                <div v-if="scannerError" class="px-4 pt-3">
                    <UAlert
                        color="error"
                        variant="soft"
                        icon="i-lucide-circle-alert"
                        :description="scannerError"
                        :close="true"
                        data-testid="inventory-scanner-error"
                        @update:open="scannerError = ''"
                    />
                </div>

                <div class="flex gap-2 px-4 pt-3">
                    <UButton
                        v-if="!scanning"
                        color="primary"
                        class="flex-auto justify-center"
                        :disabled="loadingRoutes || !sessionLocation"
                        :loading="loadingRoutes"
                        icon="i-lucide-camera"
                        data-testid="inventory-start"
                        @click="startScanner()"
                    >
                        {{ $t('inventory.start') }}
                    </UButton>
                    <UButton
                        v-else
                        color="warning"
                        class="flex-auto justify-center"
                        icon="i-lucide-circle-stop"
                        data-testid="inventory-stop"
                        @click="stopScanner()"
                    >
                        {{ $t('inventory.stop') }}
                    </UButton>
                    <UButton
                        v-if="scannedRouteIds.length > 0"
                        color="primary"
                        variant="soft"
                        class="flex-auto justify-center"
                        :disabled="loadingRoutes || !sessionLocation"
                        icon="i-lucide-check"
                        data-testid="inventory-finish-open"
                        @click="openFinishDialog()"
                    >
                        {{ $t('inventory.finish') }}
                    </UButton>
                </div>

                <div
                    v-if="unlocatedCount > 0"
                    class="px-4 pt-2 text-xs text-muted"
                    data-testid="inventory-unlocated-note"
                >
                    {{
                        $t(
                            'inventory.unlocatedNote',
                            { count: unlocatedCount },
                            unlocatedCount,
                        )
                    }}
                </div>
            </div>

            <div class="inventory-layout__lists" data-testid="inventory-lists">
                <template v-if="!isWideLayout">
                    <LayoutTabs
                        v-model="activeTab"
                        :items="inventoryTabs"
                        :content="false"
                        class="px-4 pt-4"
                    >
                        <template #default="{ item }">
                            <span :data-testid="`inventory-tab-${item.value}`">
                                {{ item.label }}
                            </span>
                        </template>
                    </LayoutTabs>

                    <div class="px-4 pt-3 pb-6" role="tabpanel">
                        <template v-if="activeTab === 'missing'">
                            <InventoryRouteList
                                :routes="missing"
                                mode="missing"
                                empty-icon="i-lucide-check-check"
                                :empty-title="missingEmptyTitle"
                                @action="markFound"
                            />

                            <UButton
                                v-if="missing.length"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                block
                                icon="i-lucide-plus"
                                class="mt-2"
                                data-testid="inventory-manual-open"
                                @click="openManualDialog()"
                            >
                                {{ $t('inventory.addManually') }}
                            </UButton>
                        </template>

                        <InventoryRouteList
                            v-else
                            :routes="foundRoutes"
                            mode="found"
                            empty-icon="i-lucide-scan-qr-code"
                            :empty-title="$t('inventory.noScans')"
                            @action="undoScan"
                        />
                    </div>
                </template>

                <div v-else class="inventory-columns px-4 pt-1 pb-6">
                    <section
                        class="inventory-column inventory-column--missing"
                        data-testid="inventory-column-missing"
                    >
                        <div class="flex items-center gap-2 mb-2">
                            <h2 class="text-sm font-semibold">
                                {{ $t('inventory.stillToFind') }}
                            </h2>
                            <UBadge
                                size="sm"
                                variant="soft"
                                color="warning"
                                data-testid="inventory-missing-count"
                            >
                                {{ missing.length }}
                            </UBadge>
                            <div class="flex-1" />
                            <UButton
                                v-if="missing.length"
                                color="neutral"
                                variant="ghost"
                                size="sm"
                                icon="i-lucide-plus"
                                data-testid="inventory-manual-open"
                                @click="openManualDialog()"
                            >
                                {{ $t('inventory.addManually') }}
                            </UButton>
                        </div>
                        <InventoryRouteList
                            :routes="missing"
                            mode="missing"
                            empty-icon="i-lucide-check-check"
                            :empty-title="missingEmptyTitle"
                            @action="markFound"
                        />
                    </section>

                    <section
                        class="inventory-column inventory-column--found"
                        data-testid="inventory-column-found"
                    >
                        <div class="flex items-center gap-2 mb-2">
                            <h2 class="text-sm font-semibold">
                                {{ $t('inventory.reviewFoundTitle') }}
                            </h2>
                            <UBadge
                                size="sm"
                                variant="soft"
                                color="success"
                                data-testid="inventory-found-count"
                            >
                                {{ foundRoutes.length }}
                            </UBadge>
                        </div>
                        <InventoryRouteList
                            :routes="foundRoutes"
                            mode="found"
                            empty-icon="i-lucide-scan-qr-code"
                            :empty-title="$t('inventory.noScans')"
                            @action="undoScan"
                        />
                    </section>
                </div>
            </div>
        </div>

        <LayoutDialogShell
            v-model="instructionsDialog"
            max-width="400"
            :title="$t('inventory.instructionsTitle')"
        >
            <p class="text-sm text-muted mb-3">
                {{ $t('inventory.instructionsIntro') }}
            </p>
            <ol class="instructions-list text-sm">
                <li>{{ $t('inventory.instructionsStep1') }}</li>
                <li>{{ $t('inventory.instructionsStep2') }}</li>
                <li>{{ $t('inventory.instructionsStep3') }}</li>
            </ol>
            <template #actions>
                <div class="flex-1" />
                <UButton color="primary" @click="instructionsDialog = false">
                    {{ $t('inventory.instructionsClose') }}
                </UButton>
            </template>
        </LayoutDialogShell>

        <LayoutDialogShell
            v-model="manualDialog"
            max-width="480"
            closable
            sheet-on-mobile
            :title="$t('inventory.addManuallyTitle')"
            :subtitle="$t('inventory.addManuallyHint')"
            data-testid="inventory-manual-dialog"
        >
            <UInput
                v-model="manualSearch"
                :placeholder="$t('inventory.searchRoutes')"
                :aria-label="$t('inventory.searchRoutes')"
                icon="i-lucide-search"
                class="mb-3 w-full"
                data-testid="inventory-manual-search"
            >
                <template v-if="manualSearch" #trailing>
                    <UButton
                        icon="i-lucide-x"
                        color="neutral"
                        variant="link"
                        size="sm"
                        :aria-label="$t('actions.clear')"
                        @click="manualSearch = ''"
                    />
                </template>
            </UInput>
            <LayoutListGroup
                v-if="manualMatches.length"
                class="scope-list overflow-y-auto"
            >
                <li v-for="route in manualMatches" :key="route.id">
                    <button
                        type="button"
                        class="scope-row inventory-row-button flex w-full items-center px-4 py-1 text-left"
                        :data-testid="`inventory-manual-item-${route.id}`"
                        @click="markFound(route, { closeManual: true })"
                    >
                        <span class="anchor-badge">{{
                            formatAnchorPoint(route.anchor_point)
                        }}</span>
                        <RouteSummary :route="route" size="sm" class="flex-1" />
                    </button>
                </li>
            </LayoutListGroup>
            <LayoutEmptyState
                v-else
                :card="false"
                :title="$t('table.no_data')"
            />
        </LayoutDialogShell>

        <LayoutDialogShell
            v-model="finishDialog"
            max-width="480"
            closable
            :title="$t('inventory.reviewTitle')"
            :subtitle="sessionLocation || undefined"
            data-testid="inventory-finish-dialog"
        >
            <div class="text-sm font-semibold mb-1">
                {{ $t('inventory.reviewMissingTitle') }}
                <UBadge size="sm" variant="soft" color="error" class="ml-1">
                    {{ archiveIds.length }}
                </UBadge>
            </div>
            <p v-if="missing.length" class="text-xs text-muted mb-2">
                {{ $t('inventory.reviewMissingDescription') }}
            </p>
            <LayoutListGroup
                v-if="missing.length"
                class="review-list overflow-y-auto"
            >
                <li
                    v-for="route in missing"
                    :key="`missing-${route.id}`"
                    class="flex min-h-10 items-center gap-3 px-4 py-1"
                >
                    <UCheckbox
                        :model-value="archiveSelection.has(route.id)"
                        :aria-label="route.name || route.id"
                        :data-testid="`inventory-archive-toggle-${route.id}`"
                        @update:model-value="
                            toggleArchive(route.id, $event === true)
                        "
                    />
                    <RouteSummary :route="route" size="sm" class="flex-1" />
                </li>
            </LayoutListGroup>
            <LayoutEmptyState
                v-else
                :card="false"
                icon="i-lucide-check-check"
                :title="$t('inventory.nothingToArchive')"
            />

            <p class="text-xs text-muted mt-3 mb-0">
                {{
                    $t('inventory.progress', {
                        found: foundRoutes.length,
                        total: scoped.length,
                    })
                }}
            </p>

            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    data-testid="inventory-finish-cancel"
                    @click="finishDialog = false"
                >
                    {{ $t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="warning"
                    icon="i-lucide-archive"
                    :loading="archiving"
                    data-testid="inventory-finish-confirm"
                    @click="confirmFinish"
                >
                    {{
                        archiveIds.length
                            ? $t('inventory.archiveSelected', {
                                  count: archiveIds.length,
                              })
                            : $t('inventory.archiveNone')
                    }}
                </UButton>
            </template>
        </LayoutDialogShell>

        <ConfirmDialog
            v-model="resetDialog"
            :title="$t('inventory.resetTitle')"
            :message="
                $t(
                    'inventory.resetMessage',
                    { count: scannedRouteIds.length },
                    scannedRouteIds.length,
                )
            "
            :confirm-text="$t('inventory.reset')"
            @confirm="confirmReset"
        />
    </div>
</template>

<script setup lang="ts">
import { archiveRoute, archiveRoutes, listRoutes } from '~/api/routes'
import { formatAnchorPoint, locationName } from '#shared/utils/formatting'
import {
    clearSession,
    countUnlocated,
    extractRouteId,
    hasSeenInstructions,
    loadSession,
    markInstructionsSeen,
    missingRoutes,
    persistSession,
    scopedRoutes,
    sortByAnchor,
} from '~/utils/inventory'
import type { RouteRecord } from '~/types/models'
import {
    coalesce,
    gymChangesTopic,
    type GymChange,
} from '~/utils/realtimeCache'

definePageMeta({
    middleware: 'auth',
    requiredPermission: 'run_inventory',
})

const ROUTE_FIELDS =
    'id,name,color,location,type,grade,grade_system,grade_index,anchor_point,archived,expand.location.name'
const SCAN_COOLDOWN_MS = 2000

const { t, locale } = useI18n()
const gymId = useCurrentGymId()
const { mdAndUp } = useDisplay()
const { data: locationRecords } = useLocations()
const {
    success: notifySuccess,
    error: notifyError,
    warning: notifyWarning,
} = useNotification()

const isWideLayout = computed(() => mdAndUp.value)

const allRoutes = ref<RouteRecord[]>([])
const loadingRoutes = ref(false)
const scannedRouteIds = ref<string[]>([])
const sessionLocation = ref<string | null>(null)
const restoredUnscoped = ref(false)

const viewportRef = useTemplateRef<HTMLElement>('viewportRef')
const {
    scanning,
    cameraActive,
    torchOn,
    torchSupported,
    scannerError,
    start: startCamera,
    stop: stopScanner,
    toggleTorch,
    onCameraOn,
    onCameraError,
    signalAccepted,
    signalDuplicate,
    signalRejected,
} = useQrScanner(viewportRef, () => t('inventory.cameraError'))

const instructionsDialog = ref(false)
const manualDialog = ref(false)
const manualSearch = ref('')
const finishDialog = ref(false)
const resetDialog = ref(false)
const activeTab = ref<'missing' | 'found'>('missing')
const inventoryTabs = computed(() => [
    {
        value: 'missing' as const,
        label: t('inventory.stillToFind'),
        badge: {
            label: String(missing.value.length),
            color: 'warning' as const,
            variant: 'soft' as const,
            'data-testid': 'inventory-missing-count',
        },
    },
    {
        value: 'found' as const,
        label: t('inventory.reviewFoundTitle'),
        badge: {
            label: String(foundRoutes.value.length),
            color: 'success' as const,
            variant: 'soft' as const,
            'data-testid': 'inventory-found-count',
        },
    },
])
const { pending: archiving, run: runArchive } = useAsyncAction()
const archiveSelection = ref(new Set<string>())

const cameraConstraints = {
    facingMode: 'environment',
    frameRate: { ideal: 60 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
}

const locationItems = computed(() =>
    (locationRecords.value ?? []).map((location) => ({
        title: location.name,
        value: location.id,
    })),
)

const sessionLocationName = computed(
    () =>
        locationItems.value.find((item) => item.value === sessionLocation.value)
            ?.title ?? '',
)

const locationLocked = computed(
    () => scannedRouteIds.value.length > 0 && !!sessionLocation.value,
)

const locationHint = computed(() =>
    restoredUnscoped.value && !sessionLocation.value
        ? t('inventory.locationRestoreHint')
        : t('inventory.locationHint'),
)

const scoped = computed(() =>
    scopedRoutes(allRoutes.value, sessionLocation.value),
)

const missing = computed(() =>
    missingRoutes(
        allRoutes.value,
        scannedRouteIds.value,
        sessionLocation.value,
    ),
)

const foundRoutes = computed(() => {
    const scanned = new Set(scannedRouteIds.value)
    return sortByAnchor(scoped.value.filter((route) => scanned.has(route.id)))
})

const progress = computed(() =>
    scoped.value.length
        ? (foundRoutes.value.length / scoped.value.length) * 100
        : 0,
)

const unlocatedCount = computed(() => countUnlocated(allRoutes.value))

const missingEmptyTitle = computed(() =>
    sessionLocation.value
        ? t('inventory.allFound')
        : t('inventory.locationRequired'),
)

const manualMatches = computed(() => {
    const term = (manualSearch.value || '').trim().toLowerCase()
    if (!term) return missing.value
    return missing.value.filter((route) =>
        (route.name || '').toLowerCase().includes(term),
    )
})

const archiveIds = computed(() =>
    missing.value
        .map((route) => route.id)
        .filter((id) => archiveSelection.value.has(id)),
)

useHead(() => ({
    title: t('page.title.inventory'),
    meta: [{ name: 'description', content: t('page.content.inventory') }],
}))

// ── Storage ─────────────────────────────────────────────────────────────
let storageWarningShown = false
const warnStorageUnavailable = () => {
    if (storageWarningShown) return
    storageWarningShown = true
    notifyWarning(t('inventory.storageWarning'))
}

const restoreSession = () => {
    try {
        const session = loadSession()
        scannedRouteIds.value = session.ids
        sessionLocation.value = session.location
        restoredUnscoped.value = session.ids.length > 0 && !session.location
    } catch (error) {
        console.warn('Failed to restore inventory session:', error)
        warnStorageUnavailable()
    }
}

watch(
    [scannedRouteIds, sessionLocation],
    () => {
        if (!import.meta.client) return
        try {
            persistSession({
                location: sessionLocation.value,
                ids: scannedRouteIds.value,
            })
        } catch (error) {
            console.warn('Failed to persist inventory session:', error)
            warnStorageUnavailable()
        }
    },
    { flush: 'post' },
)

const reconcileScannedIds = () => {
    if (!allRoutes.value.length) return

    const byId = new Map(allRoutes.value.map((route) => [route.id, route]))
    const resolved = scannedRouteIds.value.filter((id) => byId.has(id))

    const kept = sessionLocation.value
        ? resolved.filter(
              (id) => byId.get(id)?.location === sessionLocation.value,
          )
        : resolved

    const wrongLocation = resolved.length - kept.length
    if (wrongLocation > 0) {
        notifyWarning(
            t(
                'inventory.droppedForLocation',
                { count: wrongLocation },
                wrongLocation,
            ),
        )
    }
    if (kept.length !== scannedRouteIds.value.length) {
        scannedRouteIds.value = kept
    }
    if (sessionLocation.value) restoredUnscoped.value = false
}

watch(sessionLocation, () => reconcileScannedIds())

const acceptingScans = computed(
    () => !finishDialog.value && !manualDialog.value,
)

let routeInfoById = new Map<
    string,
    { name: string; location: string | null; locationName: string }
>()
let scannedIdSet = new Set<string>()
let activeLocation: string | null = null
let tagUnknown = ''
let tagCounted = ''

watch(
    allRoutes,
    (routes) => {
        routeInfoById = new Map(
            routes.map((route) => [
                route.id,
                {
                    name: route.name || route.id,
                    location: route.location ?? null,
                    locationName: locationName(route),
                },
            ]),
        )
    },
    { immediate: true },
)
watch(
    scannedRouteIds,
    (ids) => {
        scannedIdSet = new Set(ids)
    },
    {
        immediate: true,
    },
)
watch(
    sessionLocation,
    (value) => {
        activeLocation = value
    },
    {
        immediate: true,
    },
)
watch(
    locale,
    () => {
        tagUnknown = t('inventory.tagUnknown')
        tagCounted = t('inventory.tagCounted')
    },
    { immediate: true },
)

const themeColors = useThemeColors()

const codeTag = (rawValue: string) => {
    const id = extractRouteId(rawValue)
    const info = id ? routeInfoById.get(id) : undefined

    if (!id || !info)
        return {
            color: themeColors.value.error,
            label: tagUnknown,
        }
    if (info.location !== activeLocation) {
        return {
            color: themeColors.value.error,
            label: `${info.name} · ${info.locationName || '—'}`,
        }
    }
    if (scannedIdSet.has(id)) {
        return {
            color: themeColors.value.info,
            label: `${tagCounted} · ${info.name}`,
        }
    }
    return {
        color: themeColors.value.success,
        label: info.name,
    }
}

const onDetect = (detectedCodes: { rawValue: string }[]) => {
    if (!Array.isArray(detectedCodes) || !acceptingScans.value) return
    for (const code of detectedCodes) {
        if (code.rawValue) void handleScanResult(code.rawValue)
    }
}

const startScanner = () => {
    if (sessionLocation.value) startCamera()
}

const recentScans = new Map<string, number>()

const addScannedRoute = async (id: string) => {
    const route = allRoutes.value.find((entry) => entry.id === id)

    if (!route) {
        signalRejected()
        return
    }

    if (route.location !== sessionLocation.value) {
        signalRejected()
        return
    }

    if (scannedRouteIds.value.includes(id)) {
        signalDuplicate()
        return
    }

    if (route.archived) {
        try {
            await archiveRoute(id, false)
            allRoutes.value = allRoutes.value.map((entry) =>
                entry.id === id ? { ...entry, archived: false } : entry,
            )
            notifySuccess(
                t('inventory.restoreSuccess', { name: route.name || route.id }),
            )
        } catch (error) {
            console.error('Failed to restore archived route:', error)
            signalRejected()
            notifyError(t('inventory.restoreError'))
            return
        }
    }

    scannedRouteIds.value = [...scannedRouteIds.value, id]
    signalAccepted()
}

const handleScanResult = async (text: string) => {
    const id = extractRouteId(text)

    const key = id ?? `raw:${text}`
    const now = Date.now()
    if (now - (recentScans.get(key) ?? 0) < SCAN_COOLDOWN_MS) return
    recentScans.set(key, now)

    if (!id) {
        signalRejected()
        return
    }

    await addScannedRoute(id)
}

const markFound = (
    route: RouteRecord,
    options: { closeManual?: boolean } = {},
) => {
    if (!scannedRouteIds.value.includes(route.id)) {
        scannedRouteIds.value = [...scannedRouteIds.value, route.id]
        notifySuccess(
            t('inventory.markedFound', { name: route.name || route.id }),
        )
    }
    if (options.closeManual) manualDialog.value = false
}

const undoScan = (route: RouteRecord) => {
    scannedRouteIds.value = scannedRouteIds.value.filter(
        (id) => id !== route.id,
    )
    recentScans.delete(route.id)
    notifySuccess(t('inventory.undone', { name: route.name || route.id }))
}

const loadRoutes = async () => {
    loadingRoutes.value = true
    try {
        const { items } = await listRoutes<RouteRecord>(
            gymId.value,
            { archived: 'all', include: ['location'] },
            { fields: ROUTE_FIELDS, requestKey: null },
        )
        allRoutes.value = items
        reconcileScannedIds()
    } catch (error) {
        const message = (error as { message?: string })?.message
        if (message?.includes('autocancelled')) return
        console.error('Failed to load routes for inventory:', error)
        scannerError.value = t('inventory.loadError')
    } finally {
        loadingRoutes.value = false
    }
}

const openManualDialog = () => {
    manualSearch.value = ''
    manualDialog.value = true
}

const openFinishDialog = () => {
    archiveSelection.value = new Set(missing.value.map((route) => route.id))
    finishDialog.value = true
}

const toggleArchive = (id: string, selected: unknown) => {
    const next = new Set(archiveSelection.value)
    if (selected) next.add(id)
    else next.delete(id)
    archiveSelection.value = next
}

const resetInventory = () => {
    stopScanner()
    recentScans.clear()
    finishDialog.value = false
    archiveSelection.value = new Set()
    scannedRouteIds.value = []
    restoredUnscoped.value = false
    try {
        clearSession()
    } catch (error) {
        console.warn('Failed to clear inventory session:', error)
    }
}

const confirmReset = () => {
    resetInventory()
    resetDialog.value = false
}

const confirmFinish = async () => {
    const ids = archiveIds.value

    if (ids.length === 0) {
        resetInventory()
        notifySuccess(t('inventory.nothingToArchive'))
        await loadRoutes()
        return
    }

    await runArchive(
        async () => {
            try {
                await archiveRoutes(gymId.value, ids)
            } catch (error) {
                await loadRoutes()
                throw error
            }
            resetInventory()
            await loadRoutes()
        },
        {
            success: t(
                'inventory.archiveSuccess',
                { count: ids.length },
                ids.length,
            ),
            error: t('inventory.archiveError'),
        },
    )
}

const { data: initial } = await useAsyncData('inventory-routes', async () => {
    await loadRoutes()
    return allRoutes.value
})

if (initial.value) {
    allRoutes.value = initial.value
}

const loadRoutesSoon = coalesce(loadRoutes)
useRealtime(
    () => gymChangesTopic(gymId.value),
    (change: GymChange) => {
        if (change.collection === 'routes') loadRoutesSoon()
    },
    { onReactivate: loadRoutesSoon },
)

onMounted(() => {
    restoreSession()
    reconcileScannedIds()
    if (!hasSeenInstructions()) instructionsDialog.value = true
})

watch(instructionsDialog, (open) => {
    if (!open) markInstructionsSeen()
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.inventory-page {
    max-width: 600px;
    margin: 0 auto;
}

.progress-group {
    flex: 1 1 140px;
    min-width: 140px;
}

.inventory-locations {
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
}

.inventory-locations > * {
    flex-shrink: 0;
}

.scanner-viewport {
    position: relative;
    width: 100%;
    height: 40vh;
    min-height: 200px;
    background: #111;
    overflow: hidden;
}

.scanner-viewport__torch {
    position: absolute;
    bottom: 12px;
    right: 12px;
}

.inventory-row-button:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.instructions-list {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.review-list {
    max-height: 200px;
    overflow-y: auto;
}

@variant sm {
    .scanner-viewport {
        height: 320px;
    }
}

@variant md {
    .inventory-page {
        max-width: none;
        padding: 16px 0 24px;
    }

    .inventory-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        column-gap: 24px;
        align-items: start;
    }

    .inventory-layout__controls {
        grid-column: 1 / -1;
        margin-bottom: 16px;
    }

    .inventory-layout__lists,
    .inventory-columns {
        display: contents;
    }

    .inventory-column {
        padding-inline: 16px;
    }

    .inventory-column :deep(.scope-list) {
        max-height: calc(100vh - 360px);
    }

    .inventory-column--missing {
        grid-column: 1;
        grid-row: 2;
    }

    .inventory-column--found {
        grid-column: 2;
        grid-row: 2;
    }

    .inventory-title {
        font-size: 1.125rem;
        white-space: normal;
    }

    .scanner-viewport {
        height: 45vh;
        border-radius: 12px;
    }
}

@variant 2xl {
    .inventory-layout {
        grid-template-columns: minmax(0, 1fr) minmax(440px, 1.6fr) minmax(
                0,
                1fr
            );
    }

    .inventory-layout__controls {
        grid-column: 2;
        grid-row: 1;
        margin-bottom: 0;
    }

    .inventory-column--missing {
        grid-row: 1;
    }

    .inventory-column--found {
        grid-column: 3;
        grid-row: 1;
    }

    .progress-group {
        flex-basis: 100%;
    }

    .inventory-column :deep(.scope-list) {
        max-height: calc(100vh - 220px);
    }

    .scanner-viewport {
        height: auto;
        aspect-ratio: 4 / 3;
        max-height: calc(100vh - 300px);
    }
}
</style>
