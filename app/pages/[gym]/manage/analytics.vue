<template>
    <div class="analytics-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('analytics.title')" class="mb-6" />

        <AnalyticsFilters
            :query="query"
            :locations="locations ?? []"
            @update="updateQuery"
        />

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div
                v-for="card in summaryCards"
                :key="card.key"
                class="col-span-6 md:col-span-4 xl:col-span-2 flex"
            >
                <AnalyticsStatsCard
                    class="w-full"
                    :data-testid="`analytics-stat-${card.key}`"
                    :title="t(`analytics.cards.${card.key}`)"
                    :subtitle="card.subtitle"
                    :value="card.value"
                    :previous="card.previous"
                    :icon="card.icon"
                    :color="card.color"
                    :format="card.format"
                    :spark="card.spark"
                    :meter="card.meter"
                    :loading="initialLoading"
                />
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 lg:col-span-7 flex">
                <AnalyticsSection
                    :title="gradeTitle('grades')"
                    icon="i-lucide-chart-column"
                    color="info"
                    :loading="initialLoading"
                    :empty="!grades?.gradeDistribution.length"
                >
                    <template v-if="disciplines.length > 1" #actions>
                        <SegmentedControl
                            v-model="discipline"
                            :items="disciplineItems"
                            test-id="analytics-discipline-grades"
                        />
                    </template>
                    <AnalyticsGradeChart
                        :grades="grades!.gradeDistribution"
                        :label="disciplineLabel(discipline)"
                    />
                </AnalyticsSection>
            </div>
            <div class="col-span-12 lg:col-span-5 flex">
                <AnalyticsSection
                    :title="gradeTitle('gradeBalance')"
                    icon="i-lucide-scale"
                    color="warning"
                    :loading="initialLoading"
                    :empty="!hasGradeImbalance"
                    empty-icon="i-lucide-circle-check"
                    :empty-text="t('analytics.empty.gradeBalance')"
                >
                    <template v-if="disciplines.length > 1" #actions>
                        <SegmentedControl
                            v-model="discipline"
                            :items="disciplineItems"
                            test-id="analytics-discipline-gradeBalance"
                        />
                    </template>
                    <AnalyticsGradeBalanceChart
                        :grades="grades!.gradeDistribution"
                    />
                </AnalyticsSection>
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 lg:col-span-8 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.activity')"
                    icon="i-lucide-chart-spline"
                    color="success"
                    :loading="initialLoading"
                    :empty="!hasActivity"
                >
                    <AnalyticsActivityChart
                        :routes="analytics!.routeTimeline"
                        :ratings="analytics!.ratingTimeline"
                        :bucket="analytics!.bucket"
                    />
                </AnalyticsSection>
            </div>
            <div class="col-span-12 lg:col-span-4 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.ratingDistribution')"
                    icon="i-lucide-star"
                    color="warning"
                    :loading="initialLoading"
                    :empty="!analytics?.summary.ratings.value"
                >
                    <AnalyticsRatingDistributionChart
                        :counts="analytics!.ratingDistribution"
                    />
                </AnalyticsSection>
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 lg:col-span-7 flex">
                <AnalyticsSection
                    :title="gradeTitle('gradeFeedback')"
                    icon="i-lucide-target"
                    color="error"
                    :loading="initialLoading"
                    :empty="!grades?.gradeFeedback.length"
                    :empty-text="t('analytics.empty.gradeFeedback')"
                >
                    <template v-if="disciplines.length > 1" #actions>
                        <SegmentedControl
                            v-model="discipline"
                            :items="disciplineItems"
                            test-id="analytics-discipline-gradeFeedback"
                        />
                    </template>
                    <AnalyticsGradeFeedbackChart
                        :routes="grades!.gradeFeedback"
                    />
                </AnalyticsSection>
            </div>
            <div class="col-span-12 lg:col-span-5 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.setters')"
                    icon="i-lucide-hard-hat"
                    color="warning"
                    testid="analytics-setters"
                    :loading="initialLoading"
                    :empty="!analytics?.setters.length"
                >
                    <AnalyticsSetterChart :setters="analytics!.setters" />
                </AnalyticsSection>
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 lg:col-span-6 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.ratedRoutes')"
                    icon="i-lucide-thumbs-up"
                    color="success"
                    :loading="initialLoading"
                    :empty="!analytics?.topRated.length"
                    :empty-text="t('analytics.empty.ratedRoutes')"
                >
                    <AnalyticsRatingChart
                        :top="analytics!.topRated"
                        :lowest="analytics!.lowestRated"
                        :baseline="analytics!.ratingBaseline ?? 0"
                    />
                </AnalyticsSection>
            </div>
            <div class="col-span-12 lg:col-span-6 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.oldestActive')"
                    icon="i-lucide-history"
                    color="warning"
                    :loading="initialLoading"
                    :empty="!analytics?.oldestActive.length"
                >
                    <AnalyticsAgeChart :routes="analytics!.oldestActive" />
                </AnalyticsSection>
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 lg:col-span-8 flex">
                <AnalyticsSection
                    :title="gradeTitle('locationGrades')"
                    icon="i-lucide-map-pin"
                    color="info"
                    :loading="initialLoading"
                    :empty="!grades?.locationGrades.length"
                >
                    <template v-if="disciplines.length > 1" #actions>
                        <SegmentedControl
                            v-model="discipline"
                            :items="disciplineItems"
                            test-id="analytics-discipline-locationGrades"
                        />
                    </template>
                    <AnalyticsLocationGradeChart
                        :cells="grades!.locationGrades"
                    />
                </AnalyticsSection>
            </div>
            <div class="col-span-12 lg:col-span-4 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.latestComments')"
                    icon="i-lucide-messages-square"
                    color="secondary"
                    testid="analytics-latest-comments"
                    flush
                    :loading="initialLoading"
                    :empty="!analytics?.latestComments.length"
                    empty-icon="i-lucide-message-square-off"
                    :empty-text="t('analytics.empty.latestComments')"
                >
                    <ul class="comment-list py-1">
                        <li
                            v-for="comment in analytics!.latestComments"
                            :key="comment.id"
                        >
                            <component
                                :is="comment.routeId ? NuxtLink : 'div'"
                                :to="
                                    comment.routeId
                                        ? gymPath(
                                              `/route?id=${comment.routeId}`,
                                          )
                                        : undefined
                                "
                                class="comment-item flex items-center gap-3 px-4 py-2"
                            >
                                <div class="min-w-0 flex-1">
                                    <div class="truncate text-sm font-medium">
                                        {{
                                            comment.routeName ||
                                            t('analytics.labels.unknown')
                                        }}
                                    </div>
                                    <div
                                        class="line-clamp-2 text-xs text-muted"
                                    >
                                        {{ comment.comment }}
                                    </div>
                                </div>
                                <div
                                    v-if="comment.rating !== null"
                                    class="flex shrink-0"
                                    role="img"
                                    :aria-label="`${comment.rating}/5`"
                                >
                                    <UIcon
                                        v-for="star in 5"
                                        :key="star"
                                        name="i-lucide-star"
                                        mode="svg"
                                        :class="[
                                            'size-3.5',
                                            star <= Math.round(comment.rating)
                                                ? 'text-warning **:fill-current'
                                                : 'text-dimmed',
                                        ]"
                                    />
                                </div>
                            </component>
                        </li>
                    </ul>
                </AnalyticsSection>
            </div>
        </div>

        <div class="mb-3 grid grid-cols-12 gap-3">
            <div class="col-span-12 flex">
                <AnalyticsSection
                    :title="t('analytics.sections.activityHeatmap')"
                    icon="i-lucide-calendar-days"
                    color="success"
                    :loading="initialLoading"
                    :empty="!analytics?.dailyRouteActivity.length"
                >
                    <AnalyticsActivityHeatmap
                        :timeline="analytics!.dailyRouteActivity"
                    />
                </AnalyticsSection>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { formatNumber } from '#shared/utils/number'
import {
    DISCIPLINES,
    type Discipline,
    type TimelineDatum,
} from '#shared/utils/analytics'

const gymPath = useGymPath()

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'view_analytics',
})

const { t, locale } = useI18n()
const NuxtLink = resolveComponent('NuxtLink')

useHead(() => ({
    title: t('analytics.meta.title'),
    meta: [{ name: 'description', content: t('analytics.meta.description') }],
}))

const { query, updateQuery, analytics, initialLoading, error } =
    useClimbingAnalytics()
const { data: locations } = useLocations()
const { error: notifyError } = useNotification()

watch(
    error,
    (hasError) => {
        if (hasError) notifyError(t('analytics.error'))
    },
    { immediate: true },
)

const hasActivity = computed(() =>
    [
        ...(analytics.value?.routeTimeline ?? []),
        ...(analytics.value?.ratingTimeline ?? []),
    ].some((entry) => entry.count > 0),
)

const selectedDiscipline = ref<Discipline | null>(null)
const routeCount = (option: Discipline) =>
    (analytics.value?.grades[option].gradeDistribution ?? []).reduce(
        (sum, row) => sum + row.total,
        0,
    )
const disciplines = computed(() =>
    DISCIPLINES.filter((option) => routeCount(option) > 0),
)
const discipline = computed<Discipline>({
    get: () =>
        selectedDiscipline.value &&
        disciplines.value.includes(selectedDiscipline.value)
            ? selectedDiscipline.value
            : routeCount('Boulder') > routeCount('Route')
              ? 'Boulder'
              : 'Route',
    set: (option) => (selectedDiscipline.value = option),
})
const grades = computed(() => analytics.value?.grades[discipline.value])
const disciplineLabel = (option: Discipline) =>
    t(`ticks.kind.${option === 'Boulder' ? 'boulder' : 'route'}`)
const disciplineItems = computed(() =>
    disciplines.value.map((value) => ({
        value,
        label: disciplineLabel(value),
    })),
)
const gradeTitle = (section: string) =>
    disciplines.value.length > 1
        ? t(`analytics.sections.${section}`)
        : `${t(`analytics.sections.${section}`)} · ${disciplineLabel(discipline.value)}`

const hasGradeImbalance = computed(() =>
    (grades.value?.gradeDistribution ?? []).some(
        (row) => row.grade !== '?' && Math.abs(row.total - row.expected) >= 0.5,
    ),
)

const formatCount = (value: number) => `${value}`
const counts = (timeline: TimelineDatum[] | undefined) =>
    (timeline ?? []).map((entry) => entry.count)

const summaryCards = computed(() => {
    const data = analytics.value
    const summary = data?.summary
    const activeRoutes = summary?.activeRoutes ?? 0
    const ratedRoutes = activeRoutes - (summary?.unratedRoutes ?? 0)
    return [
        {
            key: 'activeRoutes',
            value: activeRoutes,
            previous: null,
            icon: 'i-lucide-flag-triangle-right',
            color: 'info',
            format: formatCount,
            spark: [],
            meter: activeRoutes ? ratedRoutes / activeRoutes : null,
            subtitle: t('analytics.cards.activeRoutesSubtitle', {
                n: ratedRoutes,
            }),
        },
        {
            key: 'routesSet',
            value: summary?.routesSet.value ?? 0,
            previous: summary?.routesSet.previous ?? null,
            icon: 'i-lucide-waypoints',
            color: 'success',
            format: formatCount,
            spark: counts(data?.routeTimeline),
            meter: null,
            subtitle: t('analytics.cards.routesSetSubtitle'),
        },
        {
            key: 'ratings',
            value: summary?.ratings.value ?? 0,
            previous: summary?.ratings.previous ?? null,
            icon: 'i-lucide-star',
            color: 'warning',
            format: formatCount,
            spark: counts(data?.ratingTimeline),
            meter: null,
            subtitle: t('analytics.cards.ratingsSubtitle'),
        },
        {
            key: 'averageRating',
            value: summary?.ratings.value ? summary.averageRating.value : null,
            previous: summary?.averageRating.previous ?? null,
            icon: 'i-lucide-star-half',
            color: 'warning',
            format: (value: number) => formatNumber(value, locale.value, 2),
            spark: [],
            meter: summary?.ratings.value
                ? summary.averageRating.value / 5
                : null,
            subtitle: t('analytics.cards.averageRatingSubtitle'),
        },
        {
            key: 'comments',
            value: summary?.comments.value ?? 0,
            previous: summary?.comments.previous ?? null,
            icon: 'i-lucide-messages-square',
            color: 'secondary',
            format: formatCount,
            spark: counts(data?.commentTimeline),
            meter: null,
            subtitle: t('analytics.cards.commentsSubtitle'),
        },
        {
            key: 'averageLifespan',
            value: summary?.averageLifespanDays ?? null,
            previous: null,
            icon: 'i-lucide-hourglass',
            color: 'error',
            format: (value: number) => t('analytics.labels.days', { n: value }),
            spark: [],
            meter: null,
            subtitle: t('analytics.cards.averageLifespanSubtitle'),
        },
    ]
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.comment-list {
    overflow: hidden;
}

a.comment-item:hover {
    background: color-mix(in oklab, var(--ui-text-highlighted) 4%, transparent);
}

@variant max-sm {
    .analytics-page {
        padding-inline: 12px;
    }
}
</style>
