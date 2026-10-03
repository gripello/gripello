<template>
    <div class="map-route-list">
        <template v-for="group in groups" :key="group.id">
            <p
                v-if="showHeadings"
                class="map-route-list__heading"
                data-testid="map-list-group"
            >
                {{ group.name }}
                <span class="map-route-list__muted">
                    · {{ group.routes.length }}</span
                >
            </p>
            <div
                v-for="route in group.routes"
                :key="route.id"
                class="map-route-row"
                :class="{
                    'map-route-row--active': route.id === selectedRouteId,
                }"
                data-testid="map-list-route"
                :data-route-id="route.id"
            >
                <component
                    :is="linkRows ? NuxtLink : 'button'"
                    v-bind="
                        linkRows
                            ? { to: gymPath(`/route?id=${route.id}`) }
                            : { type: 'button' }
                    "
                    class="map-route-row__main"
                    :data-testid="linkRows ? 'route-view' : undefined"
                    @click="linkRows || emit('select', route.id)"
                >
                    <RouteColorDot
                        :color="route.color"
                        :ticked="tickedIds.has(route.id)"
                        :size="26"
                    />
                    <span class="map-route-row__text">
                        <span class="map-route-row__name"
                            >{{ route.name }}
                            <TaskDefectMarker
                                :severity="defects?.get(route.id)"
                                size="sm"
                                class="align-[-2px]"
                        /></span>
                        <span class="map-route-row__meta">{{
                            subtitle(route)
                        }}</span>
                    </span>
                    <GradeLabel
                        :source="route"
                        :show-system="isUnexpectedSystem(route)"
                        class="map-route-row__grade"
                    />
                    <UIcon
                        v-if="linkRows"
                        name="i-lucide-chevron-right"
                        class="map-route-row__chevron"
                        aria-hidden="true"
                    />
                </component>
                <NuxtLink
                    v-if="!linkRows"
                    :to="gymPath(`/route?id=${route.id}`)"
                    class="map-route-row__open"
                    :aria-label="$t('routes.view')"
                    :title="$t('routes.view')"
                    data-testid="route-view"
                >
                    <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
                </NuxtLink>
            </div>
        </template>
        <LayoutEmptyState
            v-if="!groups.length"
            :card="false"
            :title="$t('table.no_data')"
        />
    </div>
</template>

<script setup lang="ts">
import type { RouteListItem } from '~/types/models'
import type { DefectSeverity } from '~/utils/tasks'
import { formatAnchorPoint } from '#shared/utils/formatting'

const gymPath = useGymPath()

defineProps<{
    groups: { id: string; name: string; routes: RouteListItem[] }[]
    showHeadings: boolean
    tickedIds: ReadonlySet<string>
    defects?: ReadonlyMap<string, DefectSeverity>
    selectedRouteId: string | null
    linkRows?: boolean
}>()

const NuxtLink = resolveComponent('NuxtLink')
const emit = defineEmits<{ select: [routeId: string] }>()
const { t } = useI18n()
const { isUnexpectedSystem } = useGradeSystems()

function subtitle(route: RouteListItem) {
    const anchor = formatAnchorPoint(route.anchor_point)
    const parts = [
        route.type ? t(`routes.types.${route.type.toLowerCase()}`) : '',
        ['—', '-'].includes(String(anchor))
            ? ''
            : `${t('climbing.anchor_point')} ${anchor}`,
    ]
    return parts.filter(Boolean).join(' · ')
}
</script>

<style scoped>
.map-route-list__heading {
    margin: 12px 8px 4px;
    font-weight: 600;
}

.map-route-list__muted {
    color: var(--ui-text-muted);
}

.map-route-row {
    display: flex;
    align-items: center;
    border-radius: 8px;
    content-visibility: auto;
    contain-intrinsic-size: auto 56px;
}

.map-route-row--active {
    background: color-mix(in oklab, var(--ui-primary) 12%, transparent);
}

.map-route-row__main {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    min-height: 56px;
    padding: 6px 8px;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    border-radius: 8px;
}

.map-route-row__chevron {
    flex: 0 0 auto;
    font-size: 20px;
    color: var(--ui-text-muted);
}

.map-route-row__main:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

.map-route-row__main:focus-visible,
.map-route-row__open:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

.map-route-row__text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
}

.map-route-row__name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.map-route-row__meta {
    font-size: 0.75rem;
    color: var(--ui-text-muted);
}

.map-route-row__grade {
    flex: 0 0 auto;
    font-weight: 700;
    font-size: 1rem;
}

.map-route-row__open {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 36px;
    height: 36px;
    margin-right: 4px;
    border-radius: 8px;
    color: inherit;
    font-size: 20px;
    text-decoration: none;
    background: color-mix(in oklab, var(--ui-text-highlighted) 8%, transparent);
}
</style>
