<template>
    <div
        class="relative flex h-dvh flex-col gap-6 overflow-hidden bg-(--app-bg) p-6 text-default lg:p-10"
        data-testid="competition-tv"
    >
        <div
            class="pointer-events-none absolute inset-x-0 top-0 h-72 bg-linear-to-b from-primary/10 to-transparent"
        />
        <header class="relative flex flex-wrap items-center gap-6">
            <LayoutBrandLogo
                v-if="gym"
                :gym="gym"
                class="tv-logo hidden md:flex"
            />
            <div class="min-w-0 flex-1 basis-full md:basis-0">
                <div class="mb-2 flex flex-wrap items-center gap-3">
                    <span
                        v-if="isLive"
                        class="inline-flex items-center gap-2 rounded-full bg-error/15 px-3 py-1 text-sm font-bold tracking-wider text-error uppercase"
                        data-testid="competition-tv-live"
                    >
                        <span class="relative flex size-2.5">
                            <span
                                class="absolute inline-flex size-full animate-ping rounded-full bg-error opacity-75"
                            />
                            <span
                                class="relative inline-flex size-2.5 rounded-full bg-error"
                            />
                        </span>
                        {{ t('competitions.tv.live') }}
                    </span>
                    <span
                        v-else-if="competition && !isPreStart"
                        class="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"
                    >
                        {{ t(`competitions.phases.${phase}.title`) }}
                    </span>
                    <span
                        v-if="countdown"
                        class="text-lg whitespace-nowrap text-muted tabular-nums"
                        data-testid="competition-tv-countdown"
                    >
                        {{ t('competitions.tv.endsIn') }} {{ countdown }}
                    </span>
                </div>
                <h1
                    class="line-clamp-2 text-4xl font-black tracking-tight break-words text-highlighted lg:text-6xl"
                >
                    {{ competition?.name }}
                </h1>
            </div>
            <div
                class="hidden text-right text-5xl font-light text-muted tabular-nums md:block"
            >
                {{ clock }}
            </div>
            <div
                v-if="qrDataUrl && !isPreStart"
                class="flex flex-col items-center gap-1 rounded-2xl bg-white p-3 shadow-sm ring ring-default"
            >
                <img
                    :src="qrDataUrl"
                    :alt="t('competitions.qrCode')"
                    class="size-32 lg:size-44"
                />
                <span class="text-sm font-semibold text-black">{{
                    t('competitions.standings.scanToJoin')
                }}</span>
            </div>
        </header>

        <div
            v-if="isPreStart"
            class="relative flex min-h-0 flex-1 items-center justify-center gap-[6vw]"
            data-testid="competition-tv-prestart"
        >
            <div class="flex max-w-2xl flex-col gap-6">
                <span
                    class="self-start rounded-full bg-primary/10 px-5 py-2 text-2xl font-bold text-primary lg:text-3xl"
                    >{{ t(`competitions.phases.${phase}.title`) }}</span
                >
                <p
                    class="text-5xl font-black tracking-tight text-highlighted lg:text-7xl"
                >
                    {{ t('competitions.standings.scanToJoin') }}
                </p>
                <p
                    v-if="startsIn"
                    class="text-3xl text-muted tabular-nums lg:text-4xl"
                    data-testid="competition-tv-starts-in"
                >
                    {{ t('competitions.tv.startsIn') }}
                    <span class="font-bold text-highlighted">{{
                        startsIn
                    }}</span>
                </p>
                <p v-if="participantCount" class="text-2xl text-muted">
                    {{
                        t(
                            'competitions.entryCount',
                            { n: participantCount },
                            participantCount,
                        )
                    }}
                </p>
            </div>
            <div
                v-if="qrDataUrl"
                class="flex shrink-0 flex-col items-center gap-3 rounded-[2rem] bg-white p-6 shadow-lg ring ring-default"
            >
                <img
                    :src="qrDataUrl"
                    :alt="t('competitions.qrCode')"
                    class="size-[min(55vh,38vw)]"
                />
                <span class="text-xl font-semibold text-black">{{
                    shareHost
                }}</span>
            </div>
        </div>

        <div
            v-else-if="
                results?.visibility === 'frozen' ||
                results?.visibility === 'hidden'
            "
            class="flex flex-1 flex-col items-center justify-center gap-6 text-center"
            data-testid="competition-tv-frozen"
        >
            <UIcon
                :name="
                    results.visibility === 'frozen'
                        ? 'i-lucide-snowflake'
                        : 'i-lucide-eye-off'
                "
                class="size-32 text-info"
            />
            <p class="max-w-3xl text-4xl font-semibold text-highlighted">
                {{
                    results.visibility === 'frozen'
                        ? t('competitions.standings.frozen')
                        : t('competitions.standings.hidden')
                }}
            </p>
        </div>

        <div
            v-else-if="!visibleCategories.length"
            class="flex flex-1 flex-col items-center justify-center gap-6 text-center"
        >
            <UIcon name="i-lucide-trophy" class="size-32 text-dimmed" />
            <p class="text-4xl font-semibold text-muted">
                {{ t('competitions.standings.empty') }}
            </p>
        </div>

        <div
            v-else
            class="relative mx-auto grid min-h-0 w-full flex-1 items-start gap-6"
            :class="visibleCategories.length === 1 ? 'max-w-5xl' : ''"
            :style="{
                gridTemplateColumns: `repeat(${visibleCategories.length}, minmax(0, 1fr))`,
            }"
        >
            <section
                v-for="category in visibleCategories"
                :key="category.id"
                class="flex max-h-full min-h-0 flex-col rounded-2xl bg-default p-4 shadow-sm ring ring-default"
                :data-testid="`competition-tv-category-${category.id}`"
            >
                <h2
                    class="mb-3 flex items-center gap-3 px-2 text-2xl font-bold text-highlighted lg:text-3xl"
                >
                    <span class="h-7 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span class="truncate">{{ category.name }}</span>
                </h2>
                <div
                    :ref="(element) => registerScroller(category.id, element)"
                    class="min-h-0 flex-1 overflow-hidden"
                >
                    <TransitionGroup
                        tag="ol"
                        move-class="transition-transform duration-700 ease-out"
                        class="flex flex-col gap-2"
                    >
                        <li
                            v-for="row in category.rows"
                            :key="row.entry"
                            class="flex items-center gap-4 rounded-xl px-3 py-2.5 lg:py-3"
                            :class="PODIUM_ROWS[row.rank] ?? 'bg-elevated/50'"
                            :data-testid="`standing-${row.bib}`"
                        >
                            <span
                                class="flex size-11 shrink-0 items-center justify-center rounded-full text-xl font-black tabular-nums"
                                :class="
                                    MEDALS[row.rank] ??
                                    'text-muted ring ring-default'
                                "
                                >{{ row.rank }}</span
                            >
                            <div
                                class="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-4"
                            >
                                <span
                                    class="min-w-0 truncate text-xl font-semibold text-highlighted md:flex-1 lg:text-2xl"
                                >
                                    {{
                                        row.name ||
                                        t('competitions.standings.anonymous')
                                    }}
                                </span>
                                <span
                                    v-if="results?.format !== 'lead_height'"
                                    class="flex shrink-0 gap-1.5 text-base font-semibold tabular-nums"
                                >
                                    <span
                                        class="rounded-md bg-success/15 px-2 py-0.5 text-highlighted"
                                        >{{ row.tops }}T</span
                                    >
                                    <span
                                        class="rounded-md bg-info/15 px-2 py-0.5 text-highlighted"
                                        >{{ row.zones }}Z</span
                                    >
                                </span>
                            </div>
                            <span
                                v-if="results?.format !== 'tops'"
                                class="w-16 shrink-0 lg:w-24 text-right text-2xl font-black text-highlighted tabular-nums lg:text-3xl"
                            >
                                {{ formatScore(row) }}
                            </span>
                        </li>
                    </TransitionGroup>
                </div>
            </section>
        </div>

        <footer
            v-if="results && visibleCategories.length"
            class="relative flex items-center justify-between text-sm text-dimmed"
        >
            <span>{{
                results.visibility === 'final'
                    ? t('competitions.standings.final')
                    : t('competitions.standings.updated', {
                          time: updatedTime,
                      })
            }}</span>
            <span v-if="pageCount > 1" class="flex gap-1.5">
                <span
                    v-for="index in pageCount"
                    :key="index"
                    class="size-2 rounded-full"
                    :class="index - 1 === page ? 'bg-primary' : 'bg-accented'"
                />
            </span>
        </footer>
    </div>
</template>

<script setup lang="ts">
import { competitionPhase, competitionShareUrl } from '~/utils/competitions'
import type { StandingRow } from '#shared/utils/competitionResults'
import { getCompetition } from '~/api/competitions'
import { MEDALS, PODIUM_ROWS } from '~/utils/themeColors'

definePageMeta({ layout: false })

const CATEGORIES_PER_PAGE = 3
const ROTATE_MS = 20_000
const SCROLL_STEP_MS = 50
const SCROLL_PAUSE_MS = 3_000

const { t, locale } = useI18n()
const route = useRoute()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

const { gym } = useGym()

const competitionId = computed(() => String(route.params.id ?? ''))
const qrDataUrl = ref('')
const now = ref<Date | null>(null)
const page = ref(0)

const { data: competition } = await useAsyncData(
    () => `tv-competition:${competitionId.value}`,
    () => getCompetition(competitionId.value),
    { enabled: () => !!competitionId.value },
)

if (competition.value && competition.value.gym !== useCurrentGymId().value)
    throw createError({ status: 404, fatal: true })

const { data: results } = useCompetitionResults(competitionId)

const phase = computed(() =>
    competition.value
        ? competitionPhase(competition.value, now.value ?? new Date())
        : 'draft',
)
const isLive = computed(() => phase.value === 'running')
const isPreStart = computed(
    () => phase.value === 'draft' || phase.value === 'registration',
)
const participantCount = computed(() =>
    (results.value?.categories ?? []).reduce(
        (sum, category) => sum + category.rows.length,
        0,
    ),
)
const shareHost = computed(() => requestUrl.host)

const categories = computed(() =>
    (results.value?.categories ?? []).filter(
        (category) => category.rows.length,
    ),
)
const pageCount = computed(() =>
    Math.ceil(categories.value.length / CATEGORIES_PER_PAGE),
)
const visibleCategories = computed(() => {
    const start =
        (page.value % Math.max(pageCount.value, 1)) * CATEGORIES_PER_PAGE
    return categories.value.slice(start, start + CATEGORIES_PER_PAGE)
})

const clock = computed(() =>
    now.value
        ? new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
              now.value,
          )
        : '',
)
function timeUntil(target: string) {
    if (!now.value) return ''
    const seconds = Math.max(
        0,
        Math.floor(
            (new Date(target.replace(' ', 'T')).getTime() -
                now.value.getTime()) /
                1000,
        ),
    )
    const pad = (value: number) => String(value).padStart(2, '0')
    const days = Math.floor(seconds / 86_400)
    const clockPart = `${Math.floor(seconds / 3600) % 24}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
    return days ? `${days}d ${clockPart}` : clockPart
}
const countdown = computed(() =>
    isLive.value && competition.value
        ? timeUntil(competition.value.ends_at)
        : '',
)
const startsIn = computed(() =>
    phase.value === 'registration' && competition.value
        ? timeUntil(competition.value.starts_at)
        : '',
)
const updatedTime = computed(() =>
    results.value
        ? new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
              new Date(results.value.updated),
          )
        : '',
)

function formatScore(row: StandingRow) {
    const lead = row.rankPoints !== undefined
    return new Intl.NumberFormat(locale.value, {
        maximumFractionDigits: lead ? 3 : 1,
    }).format(lead ? row.rankPoints! : row.points)
}

const scrollers = new Map<string, HTMLElement>()
const pausedUntil = new Map<string, number>()
function registerScroller(id: string, element: unknown) {
    if (element instanceof HTMLElement) scrollers.set(id, element)
    else scrollers.delete(id)
}

function scrollStep() {
    const time = Date.now()
    for (const [id, element] of scrollers) {
        if ((pausedUntil.get(id) ?? 0) > time) continue
        const atBottom =
            element.scrollTop + element.clientHeight >= element.scrollHeight - 1
        if (atBottom && element.scrollTop > 0) {
            setTimeout(() => element.scrollTo({ top: 0 }), SCROLL_PAUSE_MS)
            pausedUntil.set(id, time + SCROLL_PAUSE_MS * 2)
        } else if (!atBottom) {
            element.scrollTop += 1
        }
    }
}

useHead({
    title: computed(() =>
        t('page.title.competition', { name: competition.value?.name ?? '' }),
    ),
})

const timers: ReturnType<typeof setInterval>[] = []
onMounted(async () => {
    now.value = new Date()
    timers.push(
        setInterval(() => (now.value = new Date()), 1000),
        setInterval(() => {
            if (pageCount.value > 1)
                page.value = (page.value + 1) % pageCount.value
        }, ROTATE_MS),
        setInterval(scrollStep, SCROLL_STEP_MS),
    )
    const { default: QRCode } = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(
        competitionShareUrl(
            requestUrl.origin,
            gym.value?.slug ?? '',
            competitionId.value,
        ),
        { width: 768, margin: 1 },
    )
})
onBeforeUnmount(() => timers.forEach(clearInterval))
</script>

<style scoped>
.tv-logo :deep(img) {
    max-width: 160px;
    max-height: 72px;
}
</style>
