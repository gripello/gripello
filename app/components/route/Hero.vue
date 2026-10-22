<template>
    <div class="route-hero" data-testid="route-hero" :style="heroStyle">
        <div class="route-hero__overlay" />
        <div class="route-hero__content">
            <div class="route-hero__chips" data-testid="route-hero-chips">
                <UButton
                    icon="i-lucide-arrow-left"
                    color="neutral"
                    class="icon-btn route-hero__back max-lg:hidden bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                    :aria-label="t('errors.goBack')"
                    data-testid="route-back"
                    @click="goBack"
                />
                <UBadge
                    v-if="route.type"
                    size="lg"
                    color="neutral"
                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                    data-testid="route-type-chip"
                    :icon="
                        route.type === 'Boulder'
                            ? 'i-lucide-mountain'
                            : 'i-lucide-route'
                    "
                >
                    {{ t(`routes.types.${route.type?.toLowerCase()}`) }}
                </UBadge>
                <UBadge
                    v-if="ticked"
                    size="lg"
                    color="primary"
                    class="rounded-full"
                    icon="i-lucide-check"
                    data-testid="route-ticked"
                >
                    {{ t('ticks.sent') }}
                </UBadge>
                <UBadge
                    v-if="locationName(route)"
                    size="lg"
                    color="neutral"
                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                    icon="i-lucide-map-pin"
                >
                    {{ locationName(route) }}
                </UBadge>
                <UBadge
                    v-if="wallName(route)"
                    size="lg"
                    color="neutral"
                    class="bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                    icon="i-lucide-brick-wall"
                    data-testid="route-wall"
                >
                    {{ wallName(route) }}
                </UBadge>
            </div>

            <div class="route-hero__headline">
                <div class="route-hero__name">
                    <h1
                        class="text-[1.75rem] lg:text-[2.5rem] font-bold route-hero__ink route-hero__title"
                        data-testid="route-page-name"
                    >
                        {{ route.name }}
                    </h1>

                    <div
                        v-if="route.creator?.length"
                        class="flex items-center gap-1.5 mt-2"
                    >
                        <UIcon
                            name="i-lucide-hard-hat"
                            class="route-hero__ink-muted size-[14px]"
                        />
                        <span class="text-sm route-hero__ink-muted">{{
                            route.creator.join(', ')
                        }}</span>
                    </div>

                    <UBadge
                        v-if="perceived"
                        size="lg"
                        color="neutral"
                        :icon="PERCEIVED_GRADE_ICON"
                        class="mt-3 bg-(--hero-tint) text-(--hero-ink) hover:bg-(--hero-tint)/80 rounded-full"
                        data-testid="route-perceived-grade"
                    >
                        <span
                            >{{ t('ratings.perceived') }}
                            <b>{{ perceived.grade }}</b> ·
                            {{
                                t(
                                    'ratings.votes',
                                    { n: perceived.votes },
                                    perceived.votes,
                                )
                            }}</span
                        >
                    </UBadge>
                </div>

                <GradeConversionDialog v-if="difficulty" :source="route">
                    <template #activator="{ props: activator }">
                        <button
                            v-bind="activator"
                            type="button"
                            class="route-hero__difficulty-badge"
                            :style="difficultyBadgeStyle"
                            :aria-label="t('gradeConversion.show')"
                            :title="t('gradeConversion.show')"
                            data-testid="route-grade-badge"
                        >
                            <span
                                class="route-hero__difficulty-convert"
                                aria-hidden="true"
                                data-testid="route-grade-conversion"
                            >
                                <UIcon
                                    name="i-lucide-arrow-left-right"
                                    class="size-2.5"
                                />
                            </span>
                            <span
                                class="route-hero__difficulty-text font-black"
                                >{{ difficulty }}</span
                            >
                            <span
                                v-if="route?.grade_system"
                                class="route-hero__difficulty-system"
                                data-testid="route-grade-system"
                                >{{
                                    t(`gradeSystemsShort.${route.grade_system}`)
                                }}</span
                            >
                            <span
                                v-if="gymBand"
                                class="route-hero__difficulty-band"
                                :style="{
                                    background: gymBand.color,
                                }"
                                role="img"
                                :title="bandName(gymBand)"
                                :aria-label="bandName(gymBand)"
                                :data-band="gymBand.key"
                                data-testid="route-grade-band"
                            />
                        </button>
                    </template>
                </GradeConversionDialog>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { locationName, wallName } from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'
import { gymBandFor } from '#shared/utils/gradeReference'
import { toHex6 } from '#shared/utils/color'
import { contrastRatio, gradientEndColor } from '~/utils/color'
import {
    commonDifficulty,
    PERCEIVED_GRADE_ICON,
    type ReviewDisplay,
} from '~/utils/routeReviews'
import type { RouteListItem } from '~/types/models'

const props = defineProps<{
    route: RouteListItem
    ticked: boolean
    reviews: ReviewDisplay[]
}>()

const { t } = useI18n()
const { goBack } = useGoBack()

const difficulty = computed(() => formatGrade(props.route))

const perceived = computed(() => {
    const grade = commonDifficulty(props.reviews)
    if (!grade) return null
    const votes = props.reviews.filter(
        (review) => review.difficultyLabel,
    ).length
    return { grade, votes }
})

const themeColors = useThemeColors()
const heroColor = computed(() => props.route.color || themeColors.value.primary)
const HERO_DARK_INK = '#1a1a1a'
const heroIsLight = computed(() => {
    const background = toHex6(heroColor.value)
    return (
        contrastRatio(HERO_DARK_INK, background) >
        contrastRatio('#ffffff', background)
    )
})

const heroStyle = computed(() => {
    const color = heroColor.value
    return {
        background: `linear-gradient(135deg, ${color} 0%, ${gradientEndColor(color)} 100%)`,
        '--hero-ink': heroIsLight.value ? HERO_DARK_INK : '#ffffff',
        '--hero-tint': heroIsLight.value
            ? 'rgba(0, 0, 0, 0.12)'
            : 'rgba(255, 255, 255, 0.2)',
        '--hero-ink-muted': heroIsLight.value
            ? 'rgba(0, 0, 0, 0.72)'
            : 'rgba(255, 255, 255, 0.8)',
        '--hero-shade': heroIsLight.value
            ? 'rgba(255, 255, 255, 0.35)'
            : 'rgba(0, 0, 0, 0.45)',
        '--hero-title-shadow': heroIsLight.value
            ? 'none'
            : '0 1px 3px rgba(0, 0, 0, 0.3)',
    }
})

const { bands: gymBands, bandName } = useGymBands()
const gymBand = computed(() => gymBandFor(props.route, gymBands.value))

const difficultyBadgeStyle = computed(() => {
    const color = heroColor.value
    return {
        background: color,
        color: 'var(--hero-ink)',
        boxShadow: '0 0 0 1px var(--hero-tint)',
        '--grade-fit': Math.min(1, 3.5 / (difficulty.value?.length || 1)),
    }
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.route-hero {
    position: relative;
    padding: 16px 20px 36px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 8px;
    overflow: hidden;
}

@variant sm {
    .route-hero {
        border-radius: 16px;
    }
}

.route-hero__overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        to top,
        var(--hero-shade) 0%,
        rgba(0, 0, 0, 0.05) 60%,
        transparent 100%
    );
    pointer-events: none;
}

.route-hero__content {
    position: relative;
    z-index: 1;
}

.route-hero__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
}

.route-hero__headline {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
}

.route-hero__name {
    min-width: 0;
}

.route-hero__ink,
.route-hero__tint {
    color: var(--hero-ink);
}

.route-hero__tint {
    background: var(--hero-tint);
}

.route-hero__ink-muted {
    color: var(--hero-ink-muted);
}

.route-hero__title {
    line-height: 1.2;
    text-shadow: var(--hero-title-shadow);
}

.route-hero__difficulty-badge {
    position: relative;
    overflow: hidden;
    border: 0;
    cursor: pointer;
    flex-direction: column;
    flex-shrink: 0;
    width: 64px;
    height: 64px;
    padding: 6px 4px 0;
    border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
}

.route-hero__difficulty-convert {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.18);
}

.route-hero__difficulty-text {
    font-size: calc(1.25rem * var(--grade-fit, 1));
    line-height: 1;
    white-space: nowrap;
}

.route-hero__difficulty-band {
    position: absolute;
    inset: auto 0 0;
    height: 7px;
    box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.6);
}

.route-hero__difficulty-system {
    font-size: 0.65rem;
    font-weight: 600;
    line-height: 1;
    margin-top: 3px;
}

@variant lg {
    .route-hero {
        border-radius: 16px;
        padding: 28px 40px 60px;
        justify-content: center;
    }

    .route-hero__headline {
        align-items: center;
        justify-content: flex-start;
        gap: 24px;
    }

    .route-hero__name {
        max-width: 48rem;
    }

    .route-hero__difficulty-badge {
        width: 80px;
        height: 80px;
        padding: 10px 4px 0;
        border-radius: 20px;
    }

    .route-hero__difficulty-convert {
        top: 9px;
        right: 9px;
    }

    .route-hero__difficulty-text {
        font-size: calc(1.75rem * var(--grade-fit, 1));
    }
}
</style>
