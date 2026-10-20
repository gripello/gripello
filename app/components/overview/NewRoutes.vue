<template>
    <div class="new-routes" data-testid="overview-new">
        <NuxtLink
            v-for="route in routes"
            :key="route.id"
            :to="targetFor(route)"
            class="new-route"
            data-testid="overview-new-route"
            :data-route-id="route.id"
        >
            <RouteSummary :route="route" :meta="metaFor(route)" />
        </NuxtLink>
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
.new-routes {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(min(260px, 80%), 1fr);
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 6px;
    scroll-snap-type: x mandatory;
}

.new-route {
    display: block;
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
</style>
