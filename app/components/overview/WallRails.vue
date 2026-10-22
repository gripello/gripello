<template>
    <div
        class="wall-rails"
        :style="{ '--lanes': lanes.length, '--levels': levels }"
    >
        <div class="wall-rails__row wall-rails__head max-lg:hidden">
            <span />
            <div v-for="lane in lanes" :key="lane.type">
                <p class="text-xs font-semibold text-muted">
                    {{ lane.label }}
                </p>
                <div class="wall-rails__ticks">
                    <span
                        v-for="tick in lane.axis.ticks"
                        :key="tick.label"
                        :style="{ left: `${tick.at * 100}%` }"
                        >{{ tick.label }}</span
                    >
                </div>
            </div>
            <span />
        </div>

        <NuxtLink
            v-for="wall in rows"
            :key="wall.id"
            :to="{
                path: gymPath('/map'),
                query: { location: wall.location, wall: wall.id },
            }"
            class="wall-rails__row wall-rails__wall"
            data-testid="overview-wall"
            :data-name="wall.name"
        >
            <span
                class="flex min-w-0 items-center gap-2 lg:flex-col lg:items-start lg:gap-0.5"
            >
                <span class="truncate font-bold text-highlighted">{{
                    wall.name
                }}</span>
                <span
                    class="text-xs text-muted"
                    data-testid="overview-wall-count"
                    >{{
                        $t('overview.wallRoutes', { n: wall.count }, wall.count)
                    }}</span
                >
                <UBadge
                    v-if="wall.fresh"
                    color="primary"
                    variant="soft"
                    size="sm"
                    :label="
                        $t('overview.wallNew', { n: wall.fresh }, wall.fresh)
                    "
                    class="lg:mt-1"
                    data-testid="overview-wall-new"
                />
                <UIcon
                    name="i-lucide-chevron-right"
                    class="ms-auto size-5 shrink-0 text-muted lg:hidden"
                />
            </span>
            <span
                v-for="lane in wall.lanes"
                :key="lane.type"
                class="flex flex-col gap-0.5"
            >
                <span class="text-xs font-semibold text-muted lg:hidden">{{
                    lane.label
                }}</span>
                <span class="wall-rails__rail" aria-hidden="true">
                    <span
                        v-for="dot in lane.dots"
                        :key="dot.id"
                        class="wall-rails__dot"
                        :class="{ 'wall-rails__dot--fresh': dot.fresh }"
                        :style="{
                            left: `${dot.at * 100}%`,
                            '--level': dot.level,
                        }"
                    />
                </span>
                <span class="wall-rails__ticks lg:hidden" aria-hidden="true">
                    <span
                        v-for="tick in lane.axis.ticks"
                        :key="tick.label"
                        :style="{ left: `${tick.at * 100}%` }"
                        >{{ tick.label }}</span
                    >
                </span>
            </span>
            <UIcon
                name="i-lucide-chevron-right"
                class="size-5 self-center text-muted max-lg:hidden"
            />
        </NuxtLink>
    </div>
</template>

<script setup lang="ts">
import type { RouteListItem } from '~/types/models'
import { gradeAxis, railDots, type WallSummary } from '~/utils/overview'

const props = defineProps<{
    walls: WallSummary<RouteListItem>[]
    now: Date
}>()

const gymPath = useGymPath()
const { t } = useI18n()
const { routeGradeSystem, boulderGradeSystem } = useGradeSystems()

const LANES = [
    { type: 'Route', key: 'map.routes', system: routeGradeSystem },
    { type: 'Boulder', key: 'map.boulders', system: boulderGradeSystem },
] as const

function ofType(routes: RouteListItem[], type: string) {
    return routes.filter((route) => route.type === type)
}

const lanes = computed(() =>
    LANES.flatMap((lane) => {
        const axis = gradeAxis(
            props.walls.flatMap((wall) =>
                ofType(wall.routes, lane.type).flatMap((route) =>
                    typeof route.grade_index === 'number'
                        ? [route.grade_index]
                        : [],
                ),
            ),
            lane.system.value,
        )
        return axis ? [{ type: lane.type, label: t(lane.key), axis }] : []
    }),
)

const rows = computed(() =>
    props.walls.map((wall) => ({
        ...wall,
        count: wall.routes.length,
        lanes: lanes.value.map((lane) => ({
            ...lane,
            dots: railDots(
                ofType(wall.routes, lane.type),
                lane.axis,
                props.now,
            ),
        })),
    })),
)

const levels = computed(() =>
    Math.max(
        1,
        ...rows.value.flatMap((wall) =>
            wall.lanes.flatMap((lane) => lane.dots.map((dot) => dot.level + 1)),
        ),
    ),
)
</script>

<style scoped>
@reference "~/assets/css/main.css";

.wall-rails {
    --dot: 10px;
    --step: 11px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.wall-rails__row {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.wall-rails__wall {
    padding: 14px;
    border-radius: 12px;
    border: 1px solid var(--ui-border);
    color: inherit;
    text-decoration: none;
    transition: background-color 0.15s;
}

.wall-rails__wall:hover,
.wall-rails__wall:focus-visible {
    background: var(--ui-bg-elevated);
    outline: none;
}

.wall-rails__rail {
    position: relative;
    display: block;
    height: calc(4px + var(--dot) + (var(--levels) - 1) * var(--step));
    border-bottom: 1px solid var(--ui-border-accented);
}

.wall-rails__dot {
    position: absolute;
    bottom: calc(4px + var(--level) * var(--step));
    width: var(--dot);
    height: var(--dot);
    border-radius: 50%;
    transform: translateX(-50%);
    background: color-mix(in oklab, var(--ui-text-muted) 45%, transparent);
}

.wall-rails__dot--fresh {
    background: var(--ui-primary);
}

.wall-rails__ticks {
    position: relative;
    display: block;
    height: 16px;
    font-size: 11px;
    color: var(--ui-text-muted);
    font-variant-numeric: tabular-nums;
}

.wall-rails__ticks > span {
    position: absolute;
    transform: translateX(-50%);
}

@variant lg {
    .wall-rails {
        --dot: 10px;
        --step: 12px;
        gap: 0;
    }

    .wall-rails__row {
        display: grid;
        grid-template-columns:
            9rem repeat(var(--lanes), minmax(0, 1fr))
            1.25rem;
        column-gap: 24px;
        align-items: end;
    }

    .wall-rails__head {
        padding-bottom: 8px;
        border-bottom: 1px solid var(--ui-border);
    }

    .wall-rails__wall {
        padding: 14px 0 12px;
        border: 0;
        border-bottom: 1px solid var(--ui-border);
        border-radius: 0;
    }

    .wall-rails__wall > :first-child {
        align-self: center;
    }

    .wall-rails__ticks {
        font-size: 12px;
    }
}
</style>
