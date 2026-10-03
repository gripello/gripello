<template>
    <div class="scan-page" data-testid="scan-page">
        <h1 class="sr-only">{{ $t('scan.title') }}</h1>

        <div
            v-if="cameraActive"
            ref="viewportRef"
            class="scan-viewport"
            data-testid="scan-viewport"
        >
            <QrStream
                :formats="['QRCode']"
                :constraints="cameraConstraints"
                :tag="tagFor"
                @frame="onFrame"
                @camera-on="onCameraOn"
                @error="onCameraError"
            />
            <div class="scan-frame" aria-hidden="true" />
            <div
                v-if="!scanning"
                class="scan-starting"
                data-testid="scan-starting"
            >
                <UIcon
                    name="i-lucide-loader-circle"
                    class="size-8 animate-spin"
                />
                <span class="scan-starting__text">{{
                    $t('scan.starting')
                }}</span>
            </div>
            <UButton
                v-if="scanning && torchSupported"
                class="scan-torch"
                :icon="
                    torchOn ? 'i-lucide-flashlight' : 'i-lucide-flashlight-off'
                "
                :color="torchOn ? 'warning' : 'neutral'"
                variant="solid"
                size="lg"
                :aria-label="$t('inventory.toggleTorch')"
                data-testid="scan-torch"
                @click="toggleTorch"
            />
        </div>

        <div v-else class="scan-idle">
            <UIcon
                name="i-lucide-scan-qr-code"
                class="scan-idle__icon size-[72px]"
            />
            <p class="text-base font-medium mb-2">{{ $t('scan.title') }}</p>
            <p class="text-sm text-muted mb-6">
                {{ $t('scan.intro') }}
            </p>
            <UAlert
                v-if="scannerError"
                color="warning"
                variant="soft"
                icon="i-lucide-triangle-alert"
                :description="scannerError"
                class="mb-4 text-left"
                data-testid="scan-error"
            />
            <UButton
                color="primary"
                size="xl"
                icon="i-lucide-camera"
                data-testid="scan-start"
                @click="start"
            >
                {{ $t('scan.start') }}
            </UButton>
        </div>

        <p
            class="scan-hint text-xs text-muted"
            aria-live="polite"
            data-testid="scan-hint"
        >
            {{ hint }}
        </p>
        <div class="scan-actions">
            <UButton
                :to="gymSlug ? `/${gymSlug}/map` : '/'"
                color="neutral"
                variant="ghost"
                icon="i-lucide-map"
                data-testid="scan-open-map"
            >
                {{ $t('scan.findOnMap') }}
            </UButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { extractRouteId } from '~/utils/inventory'
import { centeredCode, type ScannedCode, type Size } from '~/utils/qr'
import { formatGrade } from '#shared/utils/grades'
import type { RouteRecord } from '~/types/models'

const { slug: gymSlug } = useGym()

definePageMeta({ footer: false })

const REJECT_COOLDOWN_MS = 1500
const FRAME_RADIUS = 0.25
const PENDING_COLOR = '#FFFFFF'
const REJECT_MESSAGE_MS = 2500
const LOOKUP_RETRY_MS = 2000

const { t } = useI18n()
const pb = usePocketbase()
const themeColors = useThemeColors()

useSeoMeta({ title: () => t('page.title.scan') })

const viewportRef = useTemplateRef<HTMLElement>('viewportRef')
const {
    scanning,
    cameraActive,
    torchOn,
    torchSupported,
    scannerError,
    start,
    stop,
    toggleTorch,
    onCameraOn,
    onCameraError,
    signalAccepted,
    signalRejected,
} = useQrScanner(viewportRef, () => t('scan.cameraError'))

const cameraConstraints = {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
}

const routes = reactive(new Map<string, RouteRecord | null>())
const offCenter = ref(false)
const opening = ref(false)
const rejected = ref(false)
let lastRejectedAt = 0
let rejectedTimer: ReturnType<typeof setTimeout> | undefined

const hint = computed(() => {
    if (opening.value) return t('scan.opening')
    if (rejected.value) return t('scan.notARoute')
    if (offCenter.value) return t('scan.center')
    return scanning.value ? t('scan.aim') : ''
})

const failedLookupAt = new Map<string, number>()

function lookup(routeId: string) {
    if (routes.has(routeId)) return
    if (Date.now() - (failedLookupAt.get(routeId) ?? 0) < LOOKUP_RETRY_MS)
        return
    routes.set(routeId, null)
    pb.collection('routes')
        .getOne<RouteRecord>(routeId, {
            fields: 'id,name,grade,grade_system',
            requestKey: null,
        })
        .then((route) => routes.set(routeId, route))
        .catch((error: { status?: number }) => {
            if (error?.status === 404)
                routes.set(routeId, { id: '', name: '', grade: '' })
            else {
                failedLookupAt.set(routeId, Date.now())
                routes.delete(routeId)
            }
        })
}

function knownRoute(routeId: string | null) {
    const route = routeId ? routes.get(routeId) : undefined
    if (route === undefined || route === null) return undefined
    return route.id ? route : false
}

function tagFor(rawValue: string) {
    const route = knownRoute(extractRouteId(rawValue))
    if (route === undefined) return { color: PENDING_COLOR, label: '…' }
    if (!route)
        return {
            color: themeColors.value.error,
            label: t('scan.unknownRoute'),
        }
    const grade = formatGrade(route)
    return {
        color: themeColors.value.success,
        label: grade ? `${route.name} · ${grade}` : route.name,
    }
}

async function openRoute(routeId: string) {
    opening.value = true
    signalAccepted()
    stop()
    await navigateTo({ path: '/route', query: { id: routeId } })
}

function reject() {
    const now = Date.now()
    if (now - lastRejectedAt < REJECT_COOLDOWN_MS) return
    lastRejectedAt = now
    rejected.value = true
    signalRejected()
    clearTimeout(rejectedTimer)
    rejectedTimer = setTimeout(() => {
        rejected.value = false
    }, REJECT_MESSAGE_MS)
}

function onFrame(codes: ScannedCode[], video: Size) {
    if (opening.value) return
    const routeCodes = codes.filter((code) => extractRouteId(code.rawValue))
    for (const code of routeCodes) lookup(extractRouteId(code.rawValue)!)
    if (codes.length && !routeCodes.length) {
        reject()
        return
    }
    const centered = centeredCode(routeCodes, video, FRAME_RADIUS)
    offCenter.value = routeCodes.length > 0 && !centered
    if (!centered) return
    const routeId = extractRouteId(centered.rawValue)!
    const route = knownRoute(routeId)
    if (route) void openRoute(routeId)
    else if (route === false) reject()
}

onMounted(start)
onBeforeUnmount(() => clearTimeout(rejectedTimer))
</script>

<style scoped>
.scan-page {
    display: flex;
    flex-direction: column;
    min-height: calc(
        100dvh - var(--app-top, 64px) - var(--app-top-inset, 0px) -
            var(--app-bottom, 0px) - var(--app-bottom-inset, 0px)
    );
}

.scan-viewport {
    position: relative;
    flex: 1;
    min-height: 320px;
    background: #111;
    overflow: hidden;
}

.scan-viewport :deep(.qr-stream) {
    position: absolute;
    inset: 0;
}

.scan-frame {
    position: absolute;
    top: 50%;
    left: 50%;
    width: min(64vw, 280px);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border: 3px solid rgba(255, 255, 255, 0.85);
    border-radius: 20px;
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
    pointer-events: none;
}

.scan-starting {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 0 32px;
    color: rgba(255, 255, 255, 0.85);
}

.scan-starting__text {
    max-width: min(56vw, 240px);
    text-align: center;
    font-size: 0.875rem;
    line-height: 1.4;
}

.scan-torch {
    position: absolute;
    right: 16px;
    bottom: 16px;
}

.scan-idle {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 24px;
    text-align: center;
}

.scan-idle__icon {
    color: color-mix(in oklab, var(--ui-text-highlighted) 30%, transparent);
    margin-bottom: 16px;
}

.scan-hint {
    min-height: 1.5em;
    margin: 12px 16px 0;
    text-align: center;
}

.scan-actions {
    display: flex;
    justify-content: center;
    padding: 4px 16px 12px;
}
</style>
