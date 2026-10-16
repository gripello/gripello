<template>
    <ol
        class="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-4 portrait:grid-cols-1"
        data-testid="tv-resets"
    >
        <li
            v-for="reset in resets"
            :key="`${reset.wall.id}:${reset.date}`"
            class="flex items-center gap-5 rounded-2xl bg-default px-5 py-4 shadow-sm ring ring-default"
        >
            <UIcon
                name="i-lucide-calendar-clock"
                class="size-12 shrink-0 text-warning"
            />
            <span class="flex min-w-0 flex-1 flex-col">
                <span
                    class="truncate text-3xl font-semibold text-highlighted"
                    >{{ reset.wall.name }}</span
                >
                <span class="text-xl text-muted">{{
                    t('tv.routeCount', { n: reset.count }, reset.count)
                }}</span>
            </span>
            <span
                class="shrink-0 text-3xl font-bold text-highlighted tabular-nums"
                >{{
                    t('routes.outSoon', {
                        date: formatDate(reset.date, {
                            locale,
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                        }),
                    })
                }}</span
            >
        </li>
    </ol>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import type { TvReset } from '~/utils/tvScreen'

defineProps<{ resets: TvReset[] }>()

const { t, locale } = useI18n()
</script>
