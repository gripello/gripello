<template>
    <div
        class="flex min-h-0 flex-1 items-center justify-center gap-[6vw] portrait:flex-col"
        data-testid="tv-info"
    >
        <div class="flex max-w-3xl min-w-0 flex-col gap-8">
            <p
                v-if="label"
                class="text-6xl font-black tracking-tight"
                :class="status?.open ? 'text-success' : 'text-highlighted'"
            >
                {{ label }}
            </p>
            <GymHoursList
                v-if="hasOpeningHours(hours)"
                :hours="hours"
                :today="today"
                class="text-3xl"
            />
            <p class="text-4xl font-semibold text-muted">
                {{ t('tv.scanToOpen') }}
            </p>
        </div>
        <TvBigQr :src="qr" :alt="t('tv.scanToOpen')" :caption="caption" />
    </div>
</template>

<script setup lang="ts">
import {
    hasOpeningHours,
    type GymOpeningHours,
} from '#shared/utils/openingHours'

const props = defineProps<{
    hours: GymOpeningHours | null | undefined
    qr: string
    caption: string
}>()

const { t } = useI18n()
const { status, today, label } = useOpenStatus(() => props.hours)
</script>
