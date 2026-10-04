<template>
    <div v-if="routes.length" class="new-routes" data-testid="overview-new">
        <NuxtLink
            v-for="route in routes"
            :key="route.id"
            :to="targetFor(route)"
            class="new-route"
            data-testid="overview-new-route"
            :data-route-id="route.id"
        >
            <RouteColorDot
                :color="route.color"
                :size="28"
                class="new-route__dot"
            />
            <span class="new-route__name">{{ route.name }}</span>
            <GradeLabel :source="route" class="new-route__grade" />
            <span class="new-route__meta">{{ metaFor(route) }}</span>
        </NuxtLink>
    </div>
    <div v-else class="new-routes-empty" data-testid="overview-new-empty">
        <UIcon name="i-lucide-calendar" class="size-[28px]" />
        <span>{{ $t('overview.newRoutesEmpty') }}</span>
    </div>
</template>

<script setup lang="ts">
import type { RouteListItem } from '~/types/models'
import { formatDate } from '#shared/utils/formatting'

const gymPath = useGymPath()

const props = defineProps<{
    routes: RouteListItem[]
    wallNames: ReadonlyMap<string, string>
}>()

const { locale } = useI18n()

function targetFor(route: RouteListItem) {
    return route.wall && route.location
        ? {
              path: gymPath('/map'),
              query: { location: route.location, route: route.id },
          }
        : { path: gymPath('/route'), query: { id: route.id } }
}

function metaFor(route: RouteListItem) {
    return [
        route.wall ? props.wallNames.get(route.wall) : '',
        formatDate(route.screw_date, { locale: locale.value }),
    ]
        .filter(Boolean)
        .join(' · ')
}
</script>

<style scoped>
.new-routes-empty {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border-radius: 12px;
    border: 1px dashed var(--ui-border);
    background: var(--ui-bg);
    color: var(--ui-text-muted);
}

.new-routes {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(168px, 1fr);
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 6px;
    scroll-snap-type: x mandatory;
}

.new-route {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: 10px;
    row-gap: 2px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid var(--ui-border);
    background: var(--ui-bg);
    color: inherit;
    text-decoration: none;
    scroll-snap-align: start;
    transition: background-color 0.15s;
}

.new-route:hover,
.new-route:focus-visible {
    background: color-mix(in oklab, var(--ui-primary) 12%, transparent);
    outline: none;
}

.new-route__dot {
    grid-row: span 2;
}

.new-route__name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.new-route__grade {
    font-weight: 700;
}

.new-route__meta {
    grid-column: 2 / span 2;
    font-size: 0.75rem;
    color: var(--ui-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
