<template>
    <LayoutDialogShell
        v-model="open"
        :title="title"
        :max-width="aspect > 1 ? 720 : 520"
        closable
        sheet-on-mobile
        data-testid="image-crop-dialog"
    >
        <div
            ref="stage"
            class="relative touch-none overflow-hidden rounded-lg bg-neutral-950 select-none"
            :style="{ height: `${stageHeight}px` }"
            data-vaul-no-drag
            data-testid="image-crop-stage"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @wheel.prevent="onWheel"
        >
            <img
                v-if="url"
                ref="image"
                :src="url"
                alt=""
                draggable="false"
                class="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
                :style="imageStyle(1, windowOrigin)"
                @load="onLoad"
            />
            <div
                class="absolute cursor-grab shadow-[0_0_0_9999px_rgb(0_0_0/0.6)] ring-2 ring-white/90 outline-none focus-visible:ring-primary active:cursor-grabbing"
                :class="round ? 'rounded-full' : 'rounded-sm'"
                :style="{
                    left: `${windowOrigin.x}px`,
                    top: `${windowOrigin.y}px`,
                    width: `${frame.width}px`,
                    height: `${frame.height}px`,
                }"
                role="group"
                tabindex="0"
                :aria-label="title"
                data-testid="image-crop-frame"
                @keydown="onKeyDown"
            >
                <div
                    v-if="dragging"
                    class="pointer-events-none absolute inset-0 overflow-hidden"
                    :class="round ? 'rounded-full' : ''"
                >
                    <span
                        v-for="line in [1, 2]"
                        :key="`v${line}`"
                        class="absolute inset-y-0 w-px bg-white/50"
                        :style="{ left: `${(line * 100) / 3}%` }"
                    />
                    <span
                        v-for="line in [1, 2]"
                        :key="`h${line}`"
                        class="absolute inset-x-0 h-px bg-white/50"
                        :style="{ top: `${(line * 100) / 3}%` }"
                    />
                </div>
                <span
                    v-if="avatarMarker"
                    class="pointer-events-none absolute aspect-square rounded-full border-2 border-dashed border-white/70"
                    :style="avatarMarkerStyle"
                    data-testid="image-crop-avatar-marker"
                />
            </div>
        </div>

        <div class="mt-4 flex items-center gap-1">
            <UButton
                icon="i-lucide-rotate-cw"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('imageCrop.rotate')"
                :disabled="!imageSize"
                data-testid="image-crop-rotate"
                @click="rotate"
            />
            <UButton
                icon="i-lucide-zoom-out"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('map.zoomOut')"
                :disabled="crop.zoom <= 1"
                @click="zoomTo(crop.zoom - 0.5)"
            />
            <USlider
                :model-value="crop.zoom"
                :min="1"
                :max="MAX_CROP_ZOOM"
                :step="0.01"
                :aria-label="$t('imageCrop.zoom')"
                class="mx-1 flex-1"
                data-testid="image-crop-zoom"
                @update:model-value="(zoom) => zoomTo(Number(zoom))"
            />
            <UButton
                icon="i-lucide-zoom-in"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('map.zoomIn')"
                :disabled="crop.zoom >= MAX_CROP_ZOOM"
                @click="zoomTo(crop.zoom + 0.5)"
            />
            <UButton
                icon="i-lucide-undo-2"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('imageCrop.reset')"
                :disabled="!imageSize"
                data-testid="image-crop-reset"
                @click="reset"
            />
        </div>

        <div
            v-if="round && imageSize"
            class="mt-4 flex items-end justify-center gap-4"
            aria-hidden="true"
            data-testid="image-crop-previews"
        >
            <span
                v-for="size in PREVIEW_SIZES"
                :key="size"
                class="relative block shrink-0 overflow-hidden rounded-full bg-elevated ring ring-default"
                :style="{ width: `${size}px`, height: `${size}px` }"
            >
                <img
                    :src="url ?? undefined"
                    alt=""
                    class="absolute top-0 left-0 max-w-none origin-top-left"
                    :style="imageStyle(size / frame.width, { x: 0, y: 0 })"
                />
            </span>
        </div>

        <template #actions>
            <UButton color="neutral" variant="ghost" @click="open = false">
                {{ $t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="primary"
                :loading="saving"
                :disabled="!imageSize"
                data-testid="image-crop-save"
                @click="save"
            >
                {{ $t('actions.save') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import {
    clampCrop,
    coverScale,
    cropRect,
    initialCrop,
    MAX_CROP_ZOOM,
    panCrop,
    type CropState,
    type CropSize,
} from '~/utils/imageCrop'

const STAGE_PADDING = 40
const MAX_ROUND_WINDOW = 300
const PREVIEW_SIZES = [80, 40, 24]
const KEY_STEP = 12

const props = defineProps<{
    file: File | null
    title: string
    aspect: number
    outputWidth: number
    round?: boolean
    avatarMarker?: boolean
}>()
const emit = defineEmits<{ cropped: [file: File]; cancel: [] }>()

const stageRef = useTemplateRef<HTMLDivElement>('stage')
const imageRef = useTemplateRef<HTMLImageElement>('image')
const url = ref<string | null>(null)
const imageSize = ref<CropSize | null>(null)
const stageWidth = ref(0)
const crop = ref<CropState>({ centerX: 0, centerY: 0, zoom: 1 })
const saving = ref(false)
const pointers = new Map<number, { x: number; y: number }>()
const dragging = ref(false)
let pinchStart: { distance: number; zoom: number } | null = null

const open = computed({
    get: () => !!props.file,
    set: (value) => {
        if (!value) emit('cancel')
    },
})

const frame = computed<CropSize>(() => {
    const available = Math.max(stageWidth.value - STAGE_PADDING * 2, 1)
    const width = props.round
        ? Math.min(available, MAX_ROUND_WINDOW)
        : available
    return { width, height: width / props.aspect }
})
const stageHeight = computed(() => frame.value.height + STAGE_PADDING * 2)
const windowOrigin = computed(() => ({
    x: (stageWidth.value - frame.value.width) / 2,
    y: STAGE_PADDING,
}))

const avatarMarkerStyle = computed(() => {
    const diameter = frame.value.height * 0.5
    return {
        width: `${diameter}px`,
        left: `${frame.value.width * 0.025}px`,
        top: `${frame.value.height - diameter * 0.6}px`,
    }
})

watch(
    () => props.file,
    (file) => {
        setSource(file ? URL.createObjectURL(file) : null)
    },
    { immediate: true },
)
onBeforeUnmount(() => setSource(null))

function setSource(next: string | null) {
    if (url.value) URL.revokeObjectURL(url.value)
    imageSize.value = null
    url.value = next
}

const observer = import.meta.client
    ? new ResizeObserver(([entry]) => {
          if (!entry) return
          stageWidth.value = entry.contentRect.width
          if (imageSize.value)
              crop.value = clampCrop(crop.value, frame.value, imageSize.value)
      })
    : null
watch(stageRef, (stage, previous) => {
    if (previous) observer?.unobserve(previous)
    if (stage) observer?.observe(stage)
})
onBeforeUnmount(() => observer?.disconnect())

function imageStyle(factor: number, origin: { x: number; y: number }) {
    if (!imageSize.value) return { visibility: 'hidden' as const }
    const scale = coverScale(frame.value, imageSize.value) * crop.value.zoom
    const x = frame.value.width / 2 - crop.value.centerX * scale
    const y = frame.value.height / 2 - crop.value.centerY * scale
    return {
        width: `${imageSize.value.width}px`,
        height: `${imageSize.value.height}px`,
        transform: `translate(${origin.x + x * factor}px, ${origin.y + y * factor}px) scale(${scale * factor})`,
    }
}

function onLoad(event: Event) {
    const image = event.target as HTMLImageElement
    imageSize.value = { width: image.naturalWidth, height: image.naturalHeight }
    reset()
}

function reset() {
    if (imageSize.value) crop.value = initialCrop(imageSize.value)
}

function zoomTo(zoom: number) {
    if (!imageSize.value) return
    crop.value = clampCrop(
        { ...crop.value, zoom },
        frame.value,
        imageSize.value,
    )
}

function pan(deltaX: number, deltaY: number) {
    if (!imageSize.value) return
    crop.value = panCrop(
        crop.value,
        deltaX,
        deltaY,
        frame.value,
        imageSize.value,
    )
}

function onWheel(event: WheelEvent) {
    zoomTo(crop.value.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
}

function pointerDistance() {
    const [first, second] = [...pointers.values()]
    return first && second
        ? Math.hypot(first.x - second.x, first.y - second.y)
        : 0
}

function onPointerDown(event: PointerEvent) {
    stageRef.value?.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    dragging.value = true
    pinchStart =
        pointers.size === 2
            ? { distance: pointerDistance(), zoom: crop.value.zoom }
            : null
}

function onPointerMove(event: PointerEvent) {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchStart && pinchStart.distance > 0) {
        zoomTo((pinchStart.zoom * pointerDistance()) / pinchStart.distance)
        return
    }
    pan(event.clientX - previous.x, event.clientY - previous.y)
}

function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId)
    pinchStart = null
    dragging.value = pointers.size > 0
}

function onKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    const moves: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
    }
    const move = moves[event.key]
    if (move) pan(...move)
    else if (event.key === '+' || event.key === '=')
        zoomTo(crop.value.zoom + 0.25)
    else if (event.key === '-') zoomTo(crop.value.zoom - 0.25)
    else return
    event.preventDefault()
}

async function rotate() {
    const image = imageRef.value
    if (!image || !imageSize.value) return
    const canvas = document.createElement('canvas')
    canvas.width = imageSize.value.height
    canvas.height = imageSize.value.width
    const context = canvas.getContext('2d')
    if (!context) return
    context.translate(canvas.width, 0)
    context.rotate(Math.PI / 2)
    context.drawImage(image, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType.value),
    )
    if (blob) setSource(URL.createObjectURL(blob))
}

const outputType = computed(() =>
    props.file?.type === 'image/png' ? 'image/png' : 'image/jpeg',
)

async function save() {
    const image = imageRef.value
    if (!props.file || !image || !imageSize.value) return
    saving.value = true
    const rect = cropRect(crop.value, frame.value, imageSize.value)
    const width = Math.min(props.outputWidth, Math.round(rect.width))
    const height = Math.round(width / props.aspect)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas
        .getContext('2d')
        ?.drawImage(
            image,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            width,
            height,
        )
    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType.value, 0.9),
    )
    saving.value = false
    if (!blob) return
    const extension = outputType.value === 'image/png' ? '.png' : '.jpg'
    emit(
        'cropped',
        new File([blob], props.file.name.replace(/\.\w+$/, extension), {
            type: outputType.value,
        }),
    )
}
</script>
