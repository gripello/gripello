<template>
    <div class="wall-tiles">
        <NuxtLink
            v-for="wall in walls"
            :key="wall.id"
            :to="{
                path: gymPath('/map'),
                query: { location: wall.location, wall: wall.id },
            }"
            class="wall-tile"
            data-testid="overview-wall"
            :data-name="wall.name"
        >
            <span class="wall-tile__name">{{ wall.name }}</span>
            <span class="wall-tile__count">{{
                $t('overview.wallRoutes', { n: wall.count })
            }}</span>
            <span
                v-for="range in wall.ranges"
                :key="range.type"
                class="wall-tile__meta"
                :data-testid="`overview-wall-range-${range.type}`"
            >
                {{
                    $t(
                        `ticks.kind.${range.type === 'Boulder' ? 'boulder' : 'route'}`,
                    )
                }}
                {{
                    range.easiest === range.hardest
                        ? range.easiest
                        : `${range.easiest} – ${range.hardest}`
                }}
            </span>
            <span v-if="wall.newest" class="wall-tile__meta">
                {{
                    $t('overview.newestSet', {
                        date: formatDate(wall.newest, { locale }),
                    })
                }}
            </span>
        </NuxtLink>
    </div>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import type { WallSummary } from '~/utils/overview'

const gymPath = useGymPath()

defineProps<{ walls: WallSummary[] }>()

const { locale } = useI18n()
</script>

<style scoped>
.wall-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
}

.wall-tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px;
    border-radius: 12px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg);
    color: inherit;
    text-decoration: none;
    transition:
        border-color 0.15s,
        background-color 0.15s;
}

.wall-tile:hover,
.wall-tile:focus-visible {
    border-color: var(--ui-primary);
    background: color-mix(in oklab, var(--ui-primary) 6%, var(--ui-bg));
    outline: none;
}

.wall-tile__name {
    font-weight: 700;
}

.wall-tile__count {
    color: var(--ui-primary);
    font-weight: 600;
    font-size: 0.875rem;
}

.wall-tile__meta {
    font-size: 0.75rem;
    color: var(--ui-text-muted);
}
</style>
