<template>
    <div
        v-if="
            results?.visibility === 'frozen' || results?.visibility === 'hidden'
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

    <template v-else>
        <div
            class="relative mx-auto grid min-h-0 w-full flex-1 items-start gap-6 portrait:grid-cols-1!"
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
                    class="min-h-0 flex-1 overflow-hidden mask-y-from-[calc(100%-0.75rem)]"
                >
                    <TransitionGroup
                        tag="ol"
                        move-class="transition-transform duration-700 ease-out"
                        class="flex flex-col gap-2 py-3"
                    >
                        <li
                            v-for="row in category.rows"
                            :key="row.entry"
                            class="flex items-center gap-4 rounded-xl px-3 py-2.5 lg:py-3"
                            :class="
                                PODIUM_ROWS[podiumRank(row)] ?? 'bg-elevated/50'
                            "
                            :data-testid="`standing-${row.bib}`"
                        >
                            <span
                                class="flex size-11 shrink-0 items-center justify-center rounded-full text-xl font-black tabular-nums"
                                :class="
                                    MEDALS[podiumRank(row)] ??
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
                                    class="flex shrink-0 gap-2 text-xl font-semibold tabular-nums lg:text-2xl"
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
                                class="w-16 shrink-0 text-right text-2xl font-black text-highlighted tabular-nums lg:w-24 lg:text-3xl"
                            >
                                {{ formatScore(row) }}
                            </span>
                        </li>
                    </TransitionGroup>
                </div>
            </section>
        </div>

        <div
            v-if="results"
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
                    class="size-3 rounded-full"
                    :class="index - 1 === page ? 'bg-primary' : 'bg-accented'"
                />
            </span>
        </div>
    </template>
</template>

<script setup lang="ts">
import type {
    CompetitionResults,
    StandingRow,
} from '#shared/utils/competitionResults'
import { MEDALS, PODIUM_ROWS, podiumRank } from '~/utils/themeColors'

const CATEGORIES_PER_PAGE = 3
const ROTATE_MS = 20_000
const SCROLL_STEP_MS = 50
const SCROLL_PAUSE_MS = 3_000

const props = defineProps<{
    results: CompetitionResults | null | undefined
}>()

const { t, locale } = useI18n()
const page = ref(0)

const categories = computed(() =>
    (props.results?.categories ?? []).filter(
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
const updatedTime = computed(() =>
    props.results
        ? new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(
              new Date(props.results.updated),
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
const rewinds = new Set<ReturnType<typeof setTimeout>>()
function registerScroller(id: string, element: unknown) {
    if (!(element instanceof HTMLElement)) return void scrollers.delete(id)
    if (!scrollers.has(id)) pausedUntil.set(id, Date.now() + SCROLL_PAUSE_MS)
    scrollers.set(id, element)
}

function scrollStep() {
    const time = Date.now()
    for (const [id, element] of scrollers) {
        if ((pausedUntil.get(id) ?? 0) > time) continue
        const atBottom =
            element.scrollTop + element.clientHeight >= element.scrollHeight - 1
        if (atBottom && element.scrollTop > 0) {
            const rewind = setTimeout(() => {
                rewinds.delete(rewind)
                element.scrollTo({ top: 0 })
            }, SCROLL_PAUSE_MS)
            rewinds.add(rewind)
            pausedUntil.set(id, time + SCROLL_PAUSE_MS * 2)
        } else if (!atBottom) {
            element.scrollTop += 1
        }
    }
}

const timers: ReturnType<typeof setInterval>[] = []
onMounted(() => {
    timers.push(
        setInterval(() => {
            if (pageCount.value > 1)
                page.value = (page.value + 1) % pageCount.value
        }, ROTATE_MS),
        setInterval(scrollStep, SCROLL_STEP_MS),
    )
})
onBeforeUnmount(() => {
    timers.forEach(clearInterval)
    rewinds.forEach(clearTimeout)
    scrollers.clear()
})
</script>
