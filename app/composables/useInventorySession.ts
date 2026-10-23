import { isAbortError } from '~/utils/errors'
import type { Ref } from 'vue'
import { gymChangesTopic } from '#shared/utils/topics'
import { archiveRoute, listRoutes } from '~/api/routes'
import {
    clearSession,
    countUnlocated,
    extractRouteId,
    loadSession,
    missingRoutes,
    persistSession,
    scopedRoutes,
    sortByAnchor,
} from '~/utils/inventory'
import type { RouteRecord } from '~/types/models'
import {
    coalesce,
    staffRouteChange,
    type GymChange,
} from '~/utils/realtimeCache'

export type ScanOutcome = 'accepted' | 'duplicate' | 'rejected'

const SCAN_COOLDOWN_MS = 2000

export function useInventorySession(options: {
    gymId: Ref<string>
    onLoadError: () => void
}) {
    const { t } = useI18n()
    const {
        success: notifySuccess,
        error: notifyError,
        warning: notifyWarning,
    } = useNotification()

    const allRoutes = ref<RouteRecord[]>([])
    const loadingRoutes = ref(false)
    const scannedRouteIds = ref<string[]>([])
    const sessionLocation = ref<string | null>(null)
    const restoredUnscoped = ref(false)

    const locationLocked = computed(
        () => scannedRouteIds.value.length > 0 && !!sessionLocation.value,
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
        return sortByAnchor(
            scoped.value.filter((route) => scanned.has(route.id)),
        )
    })
    const progress = computed(() =>
        scoped.value.length
            ? (foundRoutes.value.length / scoped.value.length) * 100
            : 0,
    )
    const unlocatedCount = computed(() => countUnlocated(allRoutes.value))

    let storageWarningShown = false
    const warnStorageUnavailable = () => {
        if (storageWarningShown) return
        storageWarningShown = true
        notifyWarning(t('inventory.storageWarning'))
    }

    const restoreSession = () => {
        try {
            const session = loadSession(options.gymId.value)
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
                persistSession(options.gymId.value, {
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

    const recentScans = new Map<string, number>()

    const addScannedRoute = async (id: string): Promise<ScanOutcome> => {
        const route = allRoutes.value.find((entry) => entry.id === id)
        if (!route || route.location !== sessionLocation.value)
            return 'rejected'
        if (scannedRouteIds.value.includes(id)) return 'duplicate'

        if (route.archived) {
            try {
                await archiveRoute(id, false)
                allRoutes.value = allRoutes.value.map((entry) =>
                    entry.id === id ? { ...entry, archived: false } : entry,
                )
                notifySuccess(
                    t('inventory.restoreSuccess', {
                        name: route.name || route.id,
                    }),
                )
            } catch (error) {
                console.error('Failed to restore archived route:', error)
                notifyError(t('inventory.restoreError'))
                return 'rejected'
            }
        }

        scannedRouteIds.value = [...scannedRouteIds.value, id]
        return 'accepted'
    }

    const scan = async (text: string): Promise<ScanOutcome | null> => {
        const id = extractRouteId(text)
        const key = id ?? `raw:${text}`
        const now = Date.now()
        if (now - (recentScans.get(key) ?? 0) < SCAN_COOLDOWN_MS) return null
        recentScans.set(key, now)
        return id ? addScannedRoute(id) : 'rejected'
    }

    const markFound = (route: RouteRecord) => {
        if (scannedRouteIds.value.includes(route.id)) return
        scannedRouteIds.value = [...scannedRouteIds.value, route.id]
        notifySuccess(
            t('inventory.markedFound', { name: route.name || route.id }),
        )
    }

    const undoScan = (route: RouteRecord) => {
        scannedRouteIds.value = scannedRouteIds.value.filter(
            (id) => id !== route.id,
        )
        recentScans.delete(route.id)
        notifySuccess(t('inventory.undone', { name: route.name || route.id }))
    }

    const loadRoutes = async () => {
        loadingRoutes.value = allRoutes.value.length === 0
        try {
            const { items } = await listRoutes<RouteRecord>(
                options.gymId.value,
                { archived: 'all', include: ['location'] },
            )
            allRoutes.value = items
            reconcileScannedIds()
        } catch (error) {
            if (isAbortError(error)) return
            console.error('Failed to load routes for inventory:', error)
            options.onLoadError()
        } finally {
            loadingRoutes.value = false
        }
    }

    const reset = () => {
        recentScans.clear()
        scannedRouteIds.value = []
        restoredUnscoped.value = false
        try {
            clearSession(options.gymId.value)
        } catch (error) {
            console.warn('Failed to clear inventory session:', error)
        }
    }

    const loadRoutesSoon = coalesce(loadRoutes)
    useRealtime(
        () => gymChangesTopic(options.gymId.value),
        (change: GymChange) => {
            if (change.collection === 'ratings') return
            const next = staffRouteChange(allRoutes.value, change)
            allRoutes.value = next.rows
            if (next.reload) loadRoutesSoon()
        },
        { resync: loadRoutesSoon },
    )

    onMounted(() => {
        restoreSession()
        reconcileScannedIds()
    })

    return {
        allRoutes,
        loadingRoutes,
        scannedRouteIds,
        sessionLocation,
        restoredUnscoped,
        locationLocked,
        scoped,
        missing,
        foundRoutes,
        progress,
        unlocatedCount,
        scan,
        markFound,
        undoScan,
        loadRoutes,
        reset,
    }
}
