<script setup lang="ts">
import 'leaflet/dist/leaflet.css'
import type { LatLngTuple, Map as LeafletMap, LayerGroup } from 'leaflet'
import { MAP_CONSENT_KEY } from '~/utils/clientStorage'
import type { GymMapMarker } from '~/utils/gymInfo'

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

const { mapTileUrl } = useRuntimeConfig().public
const consented = ref(false)
const container = ref<HTMLElement>()
let map: LeafletMap | null = null
let layer: LayerGroup | null = null
let leaflet: typeof import('leaflet') | null = null
let framed = false

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
    leaflet = await import('leaflet')
    await nextTick()
    if (!container.value || map) return
    map = leaflet.map(container.value)
    leaflet
        .tileLayer(mapTileUrl, {
            maxZoom: 19,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
        })
        .addTo(map)
    layer = leaflet.layerGroup().addTo(map)
    resizeObserver = new ResizeObserver(() => map?.invalidateSize())
    resizeObserver.observe(container.value)
    map.on('click', (e) =>
        props.draggable
            ? emit('update:position', [e.latlng.lat, e.latlng.lng])
            : emit('select', null),
    )
    drawMarkers()
}

const MOUNTAIN_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>'

function label(text: string) {
    const span = document.createElement('span')
    span.textContent = text
    return span
}

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
    return outer
}

function drawMarkers(frame = true) {
    if (!map || !layer || !leaflet) return
    layer.clearLayers()
    for (const m of props.markers) {
        const marker = leaflet
            .marker([m.lat, m.lng], {
                icon: leaflet.divIcon({
                    html: pin(m),
                    className: 'gym-map-marker',
                    iconSize: [40, 40],
                    iconAnchor: [20, 46],
                    tooltipAnchor: [0, -46],
                }),
                zIndexOffset: m.id === props.selected ? 1000 : 0,
                draggable: props.draggable,
                title: m.label,
            })
            .addTo(layer)
        if (m.label) marker.bindTooltip(label(m.label), { direction: 'top' })
        if (!props.draggable) marker.on('click', () => emit('select', m.id))
        marker.on('dragend', () => {
            const { lat, lng } = marker.getLatLng()
            emit('update:position', [lat, lng])
        })
    }
    if (frame) frameMarkers()
}

function frameMarkers() {
    if (!map) return
    const points = props.markers.map((m): LatLngTuple => [m.lat, m.lng])
    if (!points.length) {
        if (!framed) map.setView([50, 10], 4)
        return
    }
    const bounds = leaflet!.latLngBounds(points)
    if (!framed) {
        framed = true
        if (points.length > 1)
            map.fitBounds(bounds, { padding: [32, 32], maxZoom: props.zoom })
        else map.setView(points[0]!, props.zoom)
    } else if (!map.getBounds().intersects(bounds)) {
        if (points.length > 1)
            map.fitBounds(bounds, { padding: [32, 32], maxZoom: props.zoom })
        else map.setView(points[0]!, Math.max(map.getZoom(), props.zoom))
    }
}

watch(
    () => props.markers,
    () => drawMarkers(),
    { deep: true },
)
watch(
    () => props.selected,
    (id) => {
        drawMarkers(false)
        const target = props.markers.find((m) => m.id === id)
        if (map && target)
            map.flyTo(
                [target.lat, target.lng],
                Math.max(map.getZoom(), props.zoom),
                {
                    duration: 0.5,
                },
            )
    },
)
</script>

<template>
    <div
        class="gym-location-map relative isolate h-72 overflow-hidden rounded-lg border border-default bg-elevated md:h-96"
        data-testid="gym-location-map"
    >
        <div v-if="consented" ref="container" class="size-full" />
        <LayoutEmptyState
            v-else
            icon="i-lucide-map"
            :title="$t('gymInfo.location')"
            :hint="$t('gymInfo.map.consent', { provider: 'OpenStreetMap' })"
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
            class="absolute inset-x-3 bottom-8 z-[1000] sm:right-auto sm:w-96"
        >
            <slot />
        </div>
    </div>
</template>

<style>
.gym-map-marker {
    background: none;
    border: 0;
}

.gym-map-pin {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
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
}

.gym-map-pin__inner svg {
    width: 18px;
    height: 18px;
}

.gym-location-map .leaflet-tile-container img {
    width: 256.5px !important;
    height: 256.5px !important;
}

.dark .gym-location-map .leaflet-tile-pane {
    filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);
}

.dark .gym-location-map .leaflet-container {
    background: var(--ui-bg-elevated);
}

.dark .gym-location-map .leaflet-bar a,
.dark .gym-location-map .leaflet-control-attribution {
    background: var(--ui-bg-elevated);
    color: var(--ui-text);
    border-color: var(--ui-border);
}

.dark .gym-location-map .leaflet-control-attribution a {
    color: var(--ui-text-highlighted);
}

.dark .leaflet-tooltip {
    background: var(--ui-bg-elevated);
    color: var(--ui-text);
    border-color: var(--ui-border);
}

.dark .leaflet-tooltip-top::before {
    border-top-color: var(--ui-bg-elevated);
}
</style>
