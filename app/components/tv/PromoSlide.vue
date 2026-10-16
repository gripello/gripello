<template>
    <div
        class="flex min-h-0 flex-1 items-center justify-center gap-[6vw] portrait:flex-col"
        :data-testid="`tv-promo-${competition.id}`"
    >
        <div class="flex max-w-3xl min-w-0 flex-col gap-6">
            <UIcon name="i-lucide-trophy" class="size-20 text-primary" />
            <p
                class="text-6xl font-black tracking-tight break-words text-highlighted"
            >
                {{ competition.name }}
            </p>
            <p class="text-3xl text-muted">
                {{ formatCompetitionWindow(competition, locale) }}
            </p>
            <p class="text-4xl font-semibold text-highlighted">
                {{ t('competitions.standings.scanToJoin') }}
            </p>
        </div>
        <TvBigQr :src="qr" :alt="t('competitions.qrCode')" />
    </div>
</template>

<script setup lang="ts">
import { formatCompetitionWindow } from '~/utils/competitions'
import type { TvCompetition } from '~/utils/tvScreen'

defineProps<{ competition: TvCompetition; qr: string }>()

const { t, locale } = useI18n()
</script>
