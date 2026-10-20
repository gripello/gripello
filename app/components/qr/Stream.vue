<template>
    <div class="qr-stream">
        <video ref="videoRef" autoplay muted playsinline />
        <svg
            data-testid="qr-tracking-layer"
            :viewBox="`0 0 ${displaySize.width} ${displaySize.height}`"
        >
            <g v-for="item in overlay" :key="item.rawValue">
                <rect
                    :x="item.box.x"
                    :y="item.box.y"
                    :width="item.box.width"
                    :height="item.box.height"
                    rx="10"
                    fill="none"
                    :stroke="item.color"
                    stroke-width="2.5"
                />
                <rect
                    :x="item.tag.x"
                    :y="item.tag.y"
                    :width="item.tag.width"
                    :height="TAG_HEIGHT"
                    :rx="TAG_HEIGHT / 2"
                    fill="rgba(17, 17, 17, 0.75)"
                />
                <circle
                    :cx="item.tag.x + TAG_PADDING + TAG_DOT_RADIUS"
                    :cy="item.tag.y + TAG_HEIGHT / 2"
                    :r="TAG_DOT_RADIUS"
                    :fill="item.color"
                />
                <text
                    :x="item.tag.x + TAG_PADDING + TAG_DOT_RADIUS * 2 + TAG_GAP"
                    :y="item.tag.y + TAG_HEIGHT / 2"
                >
                    {{ item.label }}
                </text>
            </g>
        </svg>
    </div>
</template>

<script setup lang="ts">
import type { ReadInputBarcodeFormat } from 'zxing-wasm/reader'
import {
    mapToCover,
    predictBox,
    tagPosition,
    type Box,
    type DecodeRequest,
    type DecodeResponse,
    type ScannedCode,
    type Size,
    type TrackSample,
} from '~/utils/qr'

interface OverlayItem {
    rawValue: string
    color: string
    label: string
    box: Box
    tag: { x: number; y: number; width: number }
}

const props = defineProps<{
    formats: ReadInputBarcodeFormat[]
    constraints: MediaTrackConstraints
    tag?: (rawValue: string) => { color: string; label: string }
}>()

const emit = defineEmits<{
    detect: [codes: ScannedCode[]]
    frame: [codes: ScannedCode[], video: Size]
    'camera-on': [capabilities: Partial<MediaTrackCapabilities>]
    error: [error: Error]
}>()

const LOAD_TIMEOUT_MS = 6000
const DECODE_MAX_SIDE = 1280
const TRACK_HOLD_MS = 400
const MAX_PREDICTION_MS = 150
const TAG_HEIGHT = 26
const TAG_PADDING = 10
const TAG_DOT_RADIUS = 4
const TAG_GAP = 6
const TAG_FONT = '500 13px system-ui, sans-serif'

const videoRef = useTemplateRef<HTMLVideoElement>('videoRef')
const overlay = shallowRef<OverlayItem[]>([])
const displaySize = shallowRef<Size>({ width: 0, height: 0 })

let stream: MediaStream | null = null
let decoder: Worker | null = null
let renderRequest = 0
let unmounted = false
const trackedCodes = new Map<
    string,
    { latest: TrackSample; previous?: TrackSample }
>()
const labelWidths = new Map<string, number>()
let measureContext: CanvasRenderingContext2D | null = null

const waitForVideo = (video: HTMLVideoElement) =>
    new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Camera stream did not load')),
            LOAD_TIMEOUT_MS,
        )
        video.addEventListener(
            'loadeddata',
            () => {
                clearTimeout(timer)
                resolve()
            },
            { once: true },
        )
    })

const stopStream = () => {
    cancelAnimationFrame(renderRequest)
    decoder?.terminate()
    decoder = null
    trackedCodes.clear()
    overlay.value = []
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    if (videoRef.value) videoRef.value.srcObject = null
}

const nextVideoFrame = (video: HTMLVideoElement, callback: () => void) => {
    if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(callback)
    } else {
        requestAnimationFrame(callback)
    }
}

const labelWidth = (label: string) => {
    const cached = labelWidths.get(label)
    if (cached !== undefined) return cached
    measureContext ||= document.createElement('canvas').getContext('2d')
    if (!measureContext) return label.length * 7
    measureContext.font = TAG_FONT
    const width = measureContext.measureText(label).width
    labelWidths.set(label, width)
    return width
}

const render = () => {
    const video = videoRef.value
    const now = performance.now()
    for (const [value, { latest }] of trackedCodes) {
        if (now - latest.at > TRACK_HOLD_MS) trackedCodes.delete(value)
    }
    if (video && (trackedCodes.size || overlay.value.length)) {
        const display = { width: video.offsetWidth, height: video.offsetHeight }
        const videoSize = { width: video.videoWidth, height: video.videoHeight }
        if (
            display.width !== displaySize.value.width ||
            display.height !== displaySize.value.height
        ) {
            displaySize.value = display
        }
        overlay.value = [...trackedCodes].map(
            ([rawValue, { latest, previous }]) => {
                const box = mapToCover(
                    predictBox(latest, previous, now, MAX_PREDICTION_MS),
                    videoSize,
                    display,
                )
                const { color, label } = props.tag?.(rawValue) ?? {
                    color: '#fff',
                    label: rawValue,
                }
                const width =
                    TAG_PADDING * 2 +
                    TAG_DOT_RADIUS * 2 +
                    TAG_GAP +
                    labelWidth(label)
                const position = tagPosition(
                    box,
                    { width, height: TAG_HEIGHT },
                    display,
                    TAG_GAP,
                )
                return {
                    rawValue,
                    color,
                    label,
                    box,
                    tag: { ...position, width },
                }
            },
        )
    }
    renderRequest = requestAnimationFrame(render)
}

const scan = (video: HTMLVideoElement) => {
    const frame = document.createElement('canvas')
    const frameCtx = frame.getContext('2d', { willReadFrequently: true })
    let previousValues: string[] = []
    let scale = 1
    let grabbedAt = 0

    decoder = new Worker(
        new URL('../../workers/qrDecoder.ts', import.meta.url),
        {
            type: 'module',
        },
    )

    const requestDecode = () => {
        if (unmounted || video.readyState === 0 || !frameCtx || !decoder) return
        if (!video.videoWidth) {
            nextVideoFrame(video, requestDecode)
            return
        }
        scale = Math.min(
            1,
            DECODE_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight),
        )
        grabbedAt = performance.now()
        frame.width = Math.round(video.videoWidth * scale)
        frame.height = Math.round(video.videoHeight * scale)
        frameCtx.drawImage(video, 0, 0, frame.width, frame.height)
        const { data, width, height } = frameCtx.getImageData(
            0,
            0,
            frame.width,
            frame.height,
        )
        decoder.postMessage(
            {
                pixels: { data, width, height },
                formats: [...props.formats],
            } satisfies DecodeRequest,
            [data.buffer],
        )
    }

    decoder.onmessage = ({ data }: MessageEvent<DecodeResponse>) => {
        if (unmounted) return
        const toVideoSpace = ({ rawValue, boundingBox }: ScannedCode) => ({
            rawValue,
            boundingBox: {
                x: boundingBox.x / scale,
                y: boundingBox.y / scale,
                width: boundingBox.width / scale,
                height: boundingBox.height / scale,
            },
        })
        const codes = data.codes.map(toVideoSpace)
        const followed = data.followed.map(toVideoSpace)
        for (const code of [...codes, ...followed]) {
            const tracked = trackedCodes.get(code.rawValue)
            trackedCodes.set(code.rawValue, {
                latest: { box: code.boundingBox, at: grabbedAt },
                previous: tracked?.latest,
            })
        }
        emit('frame', codes, {
            width: video.videoWidth,
            height: video.videoHeight,
        })
        const hasNewCode = codes.some(
            (code) => !previousValues.includes(code.rawValue),
        )
        previousValues = [...codes, ...followed].map((code) => code.rawValue)
        if (hasNewCode) emit('detect', codes)
        nextVideoFrame(video, requestDecode)
    }

    decoder.onerror = (event) => {
        stopStream()
        emit('error', new Error(event.message || 'QR decoder failed to load'))
    }

    requestDecode()
    renderRequest = requestAnimationFrame(render)
}

onMounted(async () => {
    const video = videoRef.value
    if (!video) return
    try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera access requires a secure context')
        }
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: props.constraints,
        })
        if (unmounted) return stopStream()
        video.srcObject = stream
        const loaded = waitForVideo(video)
        void video.play().catch(() => {})
        await loaded
        if (unmounted) return
        const [videoTrack] = stream.getVideoTracks()
        emit('camera-on', videoTrack?.getCapabilities?.() ?? {})
        scan(video)
    } catch (error) {
        stopStream()
        if (!unmounted) emit('error', error as Error)
    }
})

onBeforeUnmount(() => {
    unmounted = true
    stopStream()
})
</script>

<style scoped>
.qr-stream {
    position: relative;
    width: 100%;
    height: 100%;
}

.qr-stream video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.qr-stream svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.qr-stream text {
    font:
        500 13px system-ui,
        sans-serif;
    fill: #fff;
    dominant-baseline: central;
}
</style>
