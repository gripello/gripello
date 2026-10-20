<template>
    <FilterSelect
        :label="gradeColumnTitle"
        v-model="selectedDifficulty"
        :placeholder="$t('filter.all')"
        clear
        @clear="selectedDifficulty = ''"
        :items="difficulties"
        label-key="text"
        value-key="value"
        :data-testid="`${testIdPrefix}-filter-difficulty`"
    />
    <FilterSelect
        :label="$t('climbing.type')"
        v-model="selectedType"
        :placeholder="$t('filter.all')"
        clear
        @clear="selectedType = ''"
        :items="types"
        label-key="text"
        value-key="value"
        :data-testid="`${testIdPrefix}-filter-type`"
    />
    <FilterSelect
        :label="$t('climbing.location')"
        v-model="selectedLocation"
        :placeholder="$t('filter.all')"
        clear
        @clear="selectedLocation = ''"
        :items="locations"
        value-key="value"
        :data-testid="`${testIdPrefix}-filter-location`"
    />
    <FilterSelect
        v-if="withWall && walls.length"
        :label="$t('map.wall')"
        v-model="selectedWall"
        :placeholder="$t('filter.all')"
        clear
        @clear="selectedWall = ''"
        :items="walls"
        label-key="text"
        value-key="value"
        :data-testid="`${testIdPrefix}-filter-wall`"
    />
</template>

<script setup lang="ts">
const props = defineProps<{
    filters: ReturnType<typeof useRouteFilters>
    testIdPrefix: string
    withWall?: boolean
}>()

const { gradeColumnTitle } = useGradeSystems()
const {
    selectedDifficulty,
    selectedType,
    selectedLocation,
    selectedWall,
    difficulties,
    types,
    locations,
    walls,
} = props.filters
</script>
