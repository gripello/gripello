<template>
    <ol
        class="grid min-h-0 flex-1 grid-cols-2 grid-rows-4 gap-4 portrait:grid-cols-1 portrait:grid-rows-10"
        data-testid="tv-new-routes"
    >
        <li
            v-for="route in routes"
            :key="route.id"
            class="flex min-h-0 items-center gap-5 rounded-2xl bg-default px-6 shadow-sm ring ring-default"
            :data-testid="`tv-route-${route.id}`"
        >
            <span
                class="size-16 shrink-0 rounded-full ring-2 ring-accented"
                :style="{ background: routeDotColor(route.color) }"
            />
            <span
                class="min-w-28 shrink-0 text-5xl font-black text-highlighted tabular-nums"
            >
                <GradeLabel :source="route" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
                <span
                    class="truncate text-4xl font-semibold text-highlighted"
                    >{{ route.name }}</span
                >
                <span v-if="route.wall" class="truncate text-2xl text-muted">{{
                    wallNames.get(route.wall)
                }}</span>
            </span>
            <UBadge
                v-if="ages.get(route.id) === 0"
                color="primary"
                size="xl"
                class="shrink-0 text-xl font-bold"
                :label="t('tv.newToday')"
                data-testid="tv-route-age"
            />
            <span
                v-else-if="ages.get(route.id)"
                class="shrink-0 text-2xl text-muted tabular-nums"
                data-testid="tv-route-age"
                >{{
                    t(
                        'time.daysAgo',
                        { n: ages.get(route.id) },
                        ages.get(route.id)!,
                    )
                }}</span
            >
        </li>
    </ol>
</template>

<script setup lang="ts">
import { routeDotColor } from '~/utils/color'
import { daysSinceSet, type TvRoute } from '~/utils/tvScreen'

const props = defineProps<{
    routes: TvRoute[]
    wallNames: ReadonlyMap<string, string>
    now: Date
}>()

const { t } = useI18n()
const ages = computed(
    () =>
        new Map(
            props.routes.map((route) => [
                route.id,
                daysSinceSet(route, props.now),
            ]),
        ),
)
</script>
