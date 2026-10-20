<template>
    <div
        class="relative flex h-dvh flex-col gap-6 overflow-hidden bg-(--app-bg) p-6 text-default select-none lg:p-10"
        :class="{ 'cursor-none': cursorHidden }"
    >
        <div
            class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-linear-to-b from-primary/10 to-transparent"
        />
        <header class="tv-drift relative flex flex-wrap items-center gap-6">
            <LayoutBrandLogo
                v-if="gym"
                :gym="gym"
                class="tv-logo hidden md:flex"
            />
            <div class="min-w-0 flex-1 basis-full md:basis-0">
                <slot name="eyebrow" />
                <h1
                    class="line-clamp-2 text-4xl font-black tracking-tight break-words text-highlighted lg:text-6xl"
                >
                    <slot name="title" />
                </h1>
            </div>
            <div
                class="hidden text-right text-5xl font-light text-muted tabular-nums md:block"
                data-testid="tv-clock"
            >
                {{ clock }}
            </div>
            <div
                v-if="qr"
                class="flex flex-col items-center gap-1 rounded-2xl bg-white p-3 shadow-sm ring ring-default"
            >
                <img :src="qr" :alt="qrAlt" class="size-32 lg:size-44" />
                <span v-if="qrLabel" class="text-sm font-semibold text-black">{{
                    qrLabel
                }}</span>
            </div>
        </header>

        <slot />

        <footer
            v-if="$slots.footer"
            class="relative flex items-center justify-between gap-4 text-sm text-muted"
        >
            <slot name="footer" />
        </footer>
        <div v-if="hydrated" data-testid="page-hydrated" hidden />
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'

defineProps<{
    gym: GymRecord | null | undefined
    qr?: string
    qrAlt?: string
    qrLabel?: string
}>()

const { locale } = useI18n()
const hydrated = useHydrated()
const { cursorHidden } = useTvKiosk()

// 16 px at 1080p in either orientation, scaling every rem size from 720p to 4K
useHead({
    htmlAttrs: { style: 'font-size: max(10px, min(1.48vmin, 0.833vmax))' },
})

const now = useMountedNow(1000)
const clock = computed(() =>
    now.value
        ? new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
              now.value,
          )
        : '',
)
</script>

<style scoped>
.tv-logo :deep(img) {
    width: auto;
    height: 4.5rem;
    max-width: 10rem;
    object-fit: contain;
}

/* static header pixels wander a little against OLED burn-in */
.tv-drift {
    animation: tv-drift 900s ease-in-out infinite alternate;
}

@keyframes tv-drift {
    to {
        translate: 3px 2px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .tv-drift {
        animation: none;
    }
}
</style>
