<template>
    <div data-testid="analytics-filters">
        <FilterBar
            :active-filter-count="activeFilterCount"
            @clear="clearFilters"
        >
            <template #search>
                <div class="min-w-0 grow max-sm:basis-0 xl:grow-0">
                    <SegmentedControl
                        v-model="rangeTab"
                        :items="rangeOptions"
                        test-id="analytics-range"
                    />
                </div>
            </template>

            <template #filters>
                <div class="contents">
                    <template v-if="range === 'custom'">
                        <UFormField
                            :label="$t('analytics.filters.from')"
                            class="w-full sm:w-auto"
                        >
                            <UInput
                                :model-value="query.from ?? ''"
                                type="date"
                                class="w-full"
                                data-testid="analytics-filter-from"
                                @update:model-value="
                                    emit('update', { from: String($event) })
                                "
                            />
                        </UFormField>
                        <UFormField
                            :label="$t('analytics.filters.to')"
                            class="w-full sm:w-auto"
                        >
                            <UInput
                                :model-value="query.to ?? ''"
                                type="date"
                                class="w-full"
                                data-testid="analytics-filter-to"
                                @update:model-value="
                                    emit('update', { to: String($event) })
                                "
                            />
                        </UFormField>
                    </template>
                    <USelect
                        :model-value="selectedLocations"
                        :items="locations"
                        label-key="name"
                        value-key="id"
                        multiple
                        :placeholder="$t('analytics.filters.locations')"
                        :aria-label="$t('analytics.filters.locations')"
                        class="w-full sm:w-56"
                        data-testid="analytics-filter-location"
                        @update:model-value="
                            emit('update', { location: $event.join(',') })
                        "
                    />
                    <USelect
                        :model-value="selectedTypes"
                        :items="typeOptions"
                        multiple
                        :placeholder="$t('analytics.filters.types')"
                        :aria-label="$t('analytics.filters.types')"
                        class="w-full sm:w-56"
                        data-testid="analytics-filter-type"
                        @update:model-value="
                            emit('update', { type: $event.join(',') })
                        "
                    />
                    <div class="flex items-center">
                        <UButton
                            class="rounded-full"
                            :color="includeArchived ? 'warning' : 'neutral'"
                            :variant="includeArchived ? 'soft' : 'outline'"
                            icon="i-lucide-archive"
                            :aria-pressed="includeArchived"
                            data-testid="analytics-filter-archived"
                            @click="
                                emit('update', {
                                    archived: includeArchived ? '' : 'true',
                                })
                            "
                        >
                            {{ $t('filter.archived') }}
                        </UButton>
                    </div>
                </div>
            </template>
        </FilterBar>
    </div>
</template>

<script setup lang="ts">
import {
    ANALYTICS_RANGES,
    type AnalyticsQuery,
    type AnalyticsRange,
} from '#shared/utils/analytics'
import { ROUTE_TYPES } from '~/utils/routes'

const props = defineProps<{
    query: AnalyticsQuery
    locations: { id: string; name: string }[]
}>()

const typeOptions: string[] = [...ROUTE_TYPES]

const emit = defineEmits<{ update: [patch: Partial<AnalyticsQuery>] }>()

const { t } = useI18n()

const range = computed<AnalyticsRange>(() =>
    ANALYTICS_RANGES.includes(props.query.range as AnalyticsRange)
        ? (props.query.range as AnalyticsRange)
        : '90d',
)
const selectedLocations = computed(() =>
    (props.query.location ?? '').split(',').filter(Boolean),
)
const selectedTypes = computed(() =>
    (props.query.type ?? '').split(',').filter(Boolean),
)
const includeArchived = computed(() => props.query.archived === 'true')
const activeFilterCount = computed(
    () =>
        [
            selectedLocations.value.length,
            selectedTypes.value.length,
            includeArchived.value,
        ].filter(Boolean).length,
)

const rangeOptions = computed(() =>
    ANALYTICS_RANGES.map((value) => ({
        value,
        label: t(`analytics.filters.ranges.${value}`),
    })),
)
const rangeTab = computed({
    get: () => range.value,
    set: (value: AnalyticsRange) => {
        if (value !== range.value) selectRange(value)
    },
})

function selectRange(value: AnalyticsRange) {
    emit(
        'update',
        value === 'custom'
            ? { range: value }
            : { range: value, from: '', to: '' },
    )
}

function clearFilters() {
    emit('update', { location: '', type: '', archived: '' })
}
</script>
