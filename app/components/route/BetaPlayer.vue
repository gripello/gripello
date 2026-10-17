<template>
    <div
        ref="frame"
        class="group/player relative size-full bg-black select-none"
        data-testid="beta-player"
    >
        <video
            ref="video"
            :src="`${src}#t=0.001`"
            playsinline
            loop
            preload="metadata"
            class="block size-full object-cover in-[:fullscreen]:object-contain"
            data-testid="beta-video-player"
            @click="toggle"
            @play="playing = true"
            @pause="playing = false"
            @timeupdate="
                current = ($event.target as HTMLVideoElement).currentTime
            "
            @loadedmetadata="onMetadata"
        />

        <button
            v-if="!playing"
            type="button"
            class="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:scale-105 hover:bg-black/60"
            :aria-label="t('beta.play')"
            data-testid="beta-play"
            @click="toggle"
        >
            <UIcon name="i-lucide-play" class="ms-1 size-8" />
        </button>

        <div
            class="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-linear-to-t from-black/80 to-transparent px-2 pt-10 pb-1 text-white transition-opacity in-[:fullscreen]:px-[max(0.5rem,env(safe-area-inset-left))] in-[:fullscreen]:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            :class="
                playing
                    ? 'opacity-0 group-hover/player:opacity-100 group-focus-within/player:opacity-100 pointer-coarse:opacity-100'
                    : 'opacity-100'
            "
        >
            <input
                v-model.number="seek"
                type="range"
                min="0"
                :max="duration || 0"
                step="0.1"
                class="beta-player__progress mx-1"
                :style="{ '--progress': `${progress}%` }"
                :aria-label="t('beta.seek')"
            />
            <div class="flex items-center gap-1 text-sm tabular-nums">
                <button
                    type="button"
                    class="beta-player__button icon-btn"
                    :aria-label="playing ? t('beta.pause') : t('beta.play')"
                    @click="toggle"
                >
                    <UIcon
                        :name="playing ? 'i-lucide-pause' : 'i-lucide-play'"
                        class="size-5"
                    />
                </button>
                <span class="flex-1 opacity-90">
                    {{ videoClock(current) }} / {{ videoClock(duration) }}
                </span>
                <button
                    type="button"
                    class="beta-player__button icon-btn"
                    :aria-label="muted ? t('beta.unmute') : t('beta.mute')"
                    @click="muted = !muted"
                >
                    <UIcon
                        :name="
                            muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'
                        "
                        class="size-5"
                    />
                </button>
                <button
                    type="button"
                    class="beta-player__button icon-btn"
                    :aria-label="
                        fullscreen
                            ? t('beta.exitFullscreen')
                            : t('beta.fullscreen')
                    "
                    data-testid="beta-fullscreen"
                    @click="fullscreen ? exitFullscreen() : enterFullscreen()"
                >
                    <UIcon
                        :name="
                            fullscreen
                                ? 'i-lucide-minimize'
                                : 'i-lucide-maximize'
                        "
                        class="size-5"
                    />
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { videoClock } from '#shared/utils/betaVideos'

defineProps<{ src: string }>()
const emit = defineEmits<{ ratio: [number] }>()

const { t } = useI18n()
const frame = useTemplateRef<HTMLDivElement>('frame')
const video = useTemplateRef<HTMLVideoElement>('video')
const playing = ref(false)
const current = ref(0)
const duration = ref(0)
const muted = ref(false)
const fullscreen = ref(false)

const progress = computed(() =>
    duration.value ? (current.value / duration.value) * 100 : 0,
)
const seek = computed({
    get: () => current.value,
    set: (time: number) => {
        if (video.value) video.value.currentTime = time
        current.value = time
    },
})

watch(muted, (value) => {
    if (video.value) video.value.muted = value
})

function toggle() {
    if (!video.value) return
    if (video.value.paused) void video.value.play()
    else video.value.pause()
}

function enterFullscreen() {
    if (frame.value?.requestFullscreen)
        frame.value.requestFullscreen().catch(() => null)
    else
        (
            video.value as
                | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
                | null
        )?.webkitEnterFullscreen?.()
}

function exitFullscreen() {
    void document.exitFullscreen?.().catch(() => null)
}

const onFullscreenChange = () =>
    (fullscreen.value =
        !!frame.value && document.fullscreenElement === frame.value)

onMounted(() => {
    if (video.value && video.value.readyState >= HTMLMediaElement.HAVE_METADATA)
        onMetadata()
    document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() =>
    document.removeEventListener('fullscreenchange', onFullscreenChange),
)

function onMetadata() {
    if (!video.value) return
    duration.value = video.value.duration
    const { videoWidth, videoHeight } = video.value
    if (videoWidth && videoHeight) emit('ratio', videoWidth / videoHeight)
}
</script>

<style scoped>
.beta-player__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 9999px;
}

@media (hover: hover) {
    .beta-player__button:hover {
        background: rgb(255 255 255 / 0.15);
    }
}

/* The input is a 24px touch strip; the visible track is drawn inside it. */
.beta-player__progress {
    appearance: none;
    height: 24px;
    cursor: pointer;
    background: transparent;
}

.beta-player__progress::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 9999px;
    background: linear-gradient(
        to right,
        var(--ui-primary) var(--progress),
        rgb(255 255 255 / 0.3) var(--progress)
    );
}

.beta-player__progress::-moz-range-track {
    height: 6px;
    border-radius: 9999px;
    background: linear-gradient(
        to right,
        var(--ui-primary) var(--progress),
        rgb(255 255 255 / 0.3) var(--progress)
    );
}

.beta-player__progress::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -5px;
    border-radius: 9999px;
    background: white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}

.beta-player__progress::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 9999px;
    background: white;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}
</style>
