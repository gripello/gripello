<template>
    <div
        class="list-card route-card rounded-lg bg-elevated"
        :data-testid="`route-card-${route.id}`"
    >
        <div class="list-card__header">
            <UCheckbox
                v-if="selectable"
                :model-value="modelValue"
                class="list-card__checkbox"
                :aria-label="$t('common.selectItem', { name: route.name })"
                data-testid="route-card-checkbox"
                @update:model-value="$emit('update:modelValue', !!$event)"
            />
            <RouteColorDot :color="route.color" :ticked="ticked" :size="32" />
            <div class="list-card__title">
                <span class="list-card__name" data-testid="route-card-name">{{
                    route.name
                }}</span>
                <span
                    v-if="route.has_ratings || route.archived || defect"
                    class="route-card__badges"
                >
                    <TaskDefectMarker :severity="defect" size="sm" />
                    <RouteRatedMarker v-if="route.has_ratings" size="sm" />
                    <UBadge
                        v-if="route.archived"
                        size="sm"
                        color="neutral"
                        variant="outline"
                        class="ml-1"
                        >{{ $t('filter.archived') }}</UBadge
                    >
                </span>
            </div>
            <GradeLabel
                v-if="difficulty"
                :source="route"
                class="route-card__difficulty"
            />
        </div>

        <USeparator />

        <div class="list-card__meta">
            <div
                v-if="route.comment"
                class="list-card__meta-row list-card__meta-row--full"
            >
                <UIcon
                    name="i-lucide-message-square-text"
                    class="list-card__meta-icon size-[15px]"
                />
                <span class="route-card__comment">{{ route.comment }}</span>
            </div>

            <div
                v-if="route.creator?.length"
                class="list-card__meta-row list-card__meta-row--full"
            >
                <UIcon
                    name="i-lucide-hard-hat"
                    class="list-card__meta-icon size-[15px]"
                />
                <div class="flex flex-wrap gap-1">
                    <UBadge
                        v-for="c in route.creator"
                        :key="c"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        >{{ c }}</UBadge
                    >
                </div>
            </div>

            <div class="list-card__pills">
                <span v-if="anchorPoint !== '—'" class="list-card__pill">
                    {{ $t('climbing.anchor_point') }} {{ anchorPoint }}
                </span>
                <span v-if="screwDate" class="list-card__pill">
                    <UIcon name="i-lucide-calendar-days" class="size-[13px]" />
                    {{ screwDate }}
                </span>
                <span v-if="locationName(route)" class="list-card__pill">
                    <UIcon name="i-lucide-map-pin" class="size-[13px]" />
                    {{ locationName(route) }}
                </span>
                <span
                    v-if="wallName(route)"
                    class="list-card__pill"
                    data-testid="route-card-wall"
                >
                    <UIcon name="i-lucide-brick-wall" class="size-[13px]" />
                    {{ wallName(route) }}
                </span>
                <span
                    v-if="route.type"
                    class="list-card__pill"
                    data-testid="route-card-type"
                >
                    <UIcon name="i-lucide-shapes" class="size-[13px]" />
                    {{ $t(`routes.types.${route.type.toLowerCase()}`) }}
                </span>
                <span v-if="hasScore" class="list-card__pill">
                    <UIcon name="i-lucide-star" class="size-[13px]" />
                    {{ score }}
                </span>
            </div>
        </div>

        <div
            v-if="$slots.actions"
            class="list-card__actions flex items-center justify-end gap-2"
        >
            <slot name="actions" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { RouteListItem } from '~/types/models'
import type { DefectSeverity } from '~/utils/tasks'
import {
    formatAnchorPoint,
    formatScore,
    formatDate,
    locationName,
    wallName,
} from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'

const props = withDefaults(
    defineProps<{
        route: RouteListItem
        selectable?: boolean
        modelValue?: boolean
        ticked?: boolean
        defect?: DefectSeverity
    }>(),
    {
        selectable: false,
        modelValue: false,
        ticked: false,
    },
)

defineEmits<{
    (e: 'update:modelValue', value: boolean): void
}>()

const { locale } = useI18n()

const difficulty = computed(() => formatGrade(props.route))
const anchorPoint = computed(() =>
    String(formatAnchorPoint(props.route.anchor_point)),
)
const screwDate = computed(() =>
    formatDate(props.route.screw_date, { locale: locale.value }),
)
const hasScore = computed(
    () =>
        typeof props.route.score === 'number' &&
        Number.isFinite(props.route.score),
)
const score = computed(() => formatScore(props.route, locale.value))
</script>

<style scoped>
.route-card__difficulty {
    margin-left: auto;
    font-size: 1.4rem;
    font-weight: 700;
    line-height: 1;
    color: color-mix(in oklab, var(--ui-text-highlighted) 55%, transparent);
    flex-shrink: 0;
}

.route-card__badges {
    display: flex;
    align-items: center;
    gap: 4px;
}

.route-card__comment {
    font-size: 0.8rem;
    color: color-mix(in oklab, var(--ui-text-highlighted) 70%, transparent);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
</style>
