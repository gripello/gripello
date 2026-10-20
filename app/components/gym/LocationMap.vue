<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import { MAP_CONSENT_KEY } from '~/utils/clientStorage'
import type { GymMapMarker } from '~/utils/gymInfo'
import { tintDarkMap } from '~/utils/mapStyle'

const props = withDefaults(
    defineProps<{
        markers: GymMapMarker[]
        draggable?: boolean
        zoom?: number
        selected?: string | null
    }>(),
    { draggable: false, zoom: 15, selected: null },
)
const emit = defineEmits<{
    'update:position': [position: [lat: number, lng: number]]
    select: [id: string | null]
}>()

const { mapStyle } = useRuntimeConfig().public
const colorMode = useColorMode()
const { t } = useI18n()
const consented = ref(false)
const container = ref<HTMLElement>()
let map: MapLibreMap | null = null
let maplibre: typeof import('maplibre-gl') | null = null
let pins: Marker[] = []
let framed = false
const overlay = ref<HTMLElement>()

onMounted(() => {
    try {
        consented.value = localStorage.getItem(MAP_CONSENT_KEY) === '1'
    } catch {}
    if (consented.value) void showMap()
})

let resizeObserver: ResizeObserver | null = null
onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    map?.remove()
})

function consent() {
    try {
        localStorage.setItem(MAP_CONSENT_KEY, '1')
    } catch {}
    consented.value = true
    void showMap()
}

async function showMap() {
    maplibre = await import('maplibre-gl')
    // Bundling moves maplibre away from the worker file it looks for next to itself.
    maplibre.setWorkerUrl(workerUrl)
    await nextTick()
    if (!container.value || map) return
    map = new maplibre.Map({
        container: container.value,
        style: mapStyle,
        center: [10, 50],
        zoom: 4,
        attributionControl: { compact: true },
    })
    map.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        'top-left',
    )
    map.addControl(recenterControl(), 'top-left')
    map.on('style.load', () => {
        if (colorMode.value === 'dark') tintDarkMap(map!)
    })
    resizeObserver = new ResizeObserver(() => map?.resize())
    resizeObserver.observe(container.value)
    map.on('click', (e) =>
        props.draggable
            ? emit('update:position', [e.lngLat.lat, e.lngLat.lng])
            : emit('select', null),
    )
    drawMarkers()
}

watch(
    () => colorMode.value,
    () => map?.setStyle(mapStyle, { diff: false }),
)

const LOCATE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/></svg>'

function recenterControl() {
    const group = document.createElement('div')
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'gym-map-recenter'
    button.title = t('gymInfo.map.recenter')
    button.setAttribute('aria-label', t('gymInfo.map.recenter'))
    button.dataset.testid = 'gym-map-recenter'
    button.innerHTML = LOCATE_ICON
    button.addEventListener('click', () => frameMarkers(true))
    group.append(button)
    return { onAdd: () => group, onRemove: () => group.remove() }
}

const MOUNTAIN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>'

function pin(marker: GymMapMarker) {
    const outer = document.createElement('div')
    outer.className =
        marker.id === props.selected
            ? 'gym-map-pin gym-map-pin--active'
            : 'gym-map-pin'
    const inner = document.createElement('div')
    inner.className = 'gym-map-pin__inner'
    if (marker.logo) {
        const img = document.createElement('img')
        img.src = marker.logo
        img.alt = ''
        inner.append(img)
    } else inner.innerHTML = MOUNTAIN_ICON
    outer.append(inner)
    const element = document.createElement('div')
    element.className = 'gym-map-marker'
    element.style.zIndex = marker.id === props.selected ? '1' : ''
    if (marker.label) {
        element.title = marker.label
        element.setAttribute('aria-label', marker.label)
    }
    element.append(outer)
    return element
}

function drawMarkers(frame = true) {
    if (!map || !maplibre) return
    for (const marker of pins) marker.remove()
    pins = props.markers.map((m) => {
        const element = pin(m)
        const marker = new maplibre!.Marker({
            element,
            anchor: 'bottom',
            draggable: props.draggable,
        })
            .setLngLat([m.lng, m.lat])
            .addTo(map!)
        element.addEventListener('click', (event) => {
            event.stopPropagation()
            if (!props.draggable) emit('select', m.id)
        })
        marker.on('dragend', () => {
            const { lat, lng } = marker.getLngLat()
            emit('update:position', [lat, lng])
        })
        return marker
    })
    if (frame) frameMarkers()
}

function frameMarkers(recenter = false) {
    if (!map || !maplibre) return
    const points = props.markers.map((m): [number, number] => [m.lng, m.lat])
    if (!points.length) return
    const bounds = points.reduce(
        (box, point) => box.extend(point),
        new maplibre.LngLatBounds(points[0], points[0]),
    )
    const fit = () =>
        points.length > 1
            ? map!.fitBounds(bounds, { padding: 32, maxZoom: props.zoom })
            : map![recenter ? 'easeTo' : 'jumpTo']({
                  center: points[0],
                  zoom:
                      framed && !recenter
                          ? Math.max(map!.getZoom(), props.zoom)
                          : props.zoom,
              })
    if (!framed || recenter) {
        framed = true
        fit()
    } else if (!points.some((point) => map!.getBounds().contains(point))) fit()
}

watch(
    () => props.markers,
    () => drawMarkers(),
    { deep: true },
)
watch(
    () => props.selected,
    async (id) => {
        drawMarkers(false)
        const target = props.markers.find((m) => m.id === id)
        if (!map || !target) return
        await nextTick()
        const coveredHeight = overlay.value?.offsetHeight ?? 0
        map.flyTo({
            center: [target.lng, target.lat],
            zoom: Math.max(map.getZoom(), props.zoom),
            offset: [0, -coveredHeight / 2],
            duration: 500,
        })
    },
)
</script>

<template>
    <div
        class="gym-location-map relative isolate h-72 overflow-hidden rounded-lg border border-default bg-elevated md:h-96"
        :class="{ 'h-auto!': !consented }"
        data-testid="gym-location-map"
    >
        <div v-if="consented" ref="container" class="size-full" />
        <LayoutEmptyState
            v-else
            icon="i-lucide-map"
            :title="$t('gymInfo.location')"
            :hint="$t('gymInfo.map.consent', { provider: 'OpenFreeMap' })"
            :card="false"
            class="flex size-full flex-col items-center justify-center p-4"
        >
            <template #actions>
                <UButton
                    icon="i-lucide-map-pin"
                    :label="$t('gymInfo.map.show')"
                    data-testid="gym-map-consent"
                    @click="consent"
                />
            </template>
        </LayoutEmptyState>
        <div
            v-if="consented && $slots.default"
            ref="overlay"
            class="absolute inset-x-3 bottom-8 z-[1000] sm:right-auto sm:w-96"
        >
            <slot />
        </div>
    </div>
</template>

<style>
.gym-map-marker {
    cursor: pointer;
}

.gym-map-pin {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-bottom: 6px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background: var(--ui-primary);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.35);
}

.gym-map-pin--active {
    transform: rotate(-45deg) scale(1.2);
    background: var(--ui-secondary);
}

.gym-map-pin__inner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    overflow: hidden;
    border-radius: 50%;
    transform: rotate(45deg);
    background: #fff;
    color: var(--ui-primary);
}

.gym-map-pin__inner img {
    width: 24px;
    height: 24px;
    object-fit: contain;
    filter: brightness(0);
}

.gym-map-pin__inner svg {
    width: 18px;
    height: 18px;
}

.gym-location-map .maplibregl-canvas-container {
    touch-action: none;
}

/* Component styles sit in a cascade layer, so beating maplibre's unlayered CSS needs !important. */
.dark .gym-location-map .maplibregl-ctrl-group,
.dark .gym-location-map .maplibregl-ctrl-attrib,
.dark .gym-location-map .maplibregl-ctrl-attrib.maplibregl-compact {
    background: var(--ui-bg-elevated) !important;
    color: var(--ui-text) !important;
}

.dark .gym-location-map .maplibregl-ctrl-group button + button {
    border-top-color: var(--ui-border) !important;
}

.gym-map-recenter {
    display: flex !important;
    align-items: center;
    justify-content: center;
}

.gym-map-recenter svg {
    width: 16px;
    height: 16px;
    color: #333;
}

.dark .gym-map-recenter svg {
    color: var(--ui-text-highlighted);
}

.dark .gym-location-map .maplibregl-ctrl-icon,
.dark .gym-location-map .maplibregl-ctrl-attrib-button {
    filter: invert(1);
}

.dark .gym-location-map .maplibregl-ctrl-attrib a {
    color: var(--ui-text-highlighted) !important;
}
</style>
