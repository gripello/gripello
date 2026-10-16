<template>
    <TvShell
        :gym="gym"
        :qr="isPreStart ? '' : qrUrl"
        :qr-alt="t('competitions.qrCode')"
        :qr-label="t('competitions.standings.scanToJoin')"
        data-testid="competition-tv"
    >
        <template #eyebrow>
            <div class="mb-2 flex flex-wrap items-center gap-3">
                <TvLivePill v-if="isLive" data-testid="competition-tv-live" />
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
        </template>
        <template #title>{{ competition?.name }}</template>

        <div
            v-if="isPreStart"
            class="relative flex min-h-0 flex-1 items-center justify-center gap-[6vw] portrait:flex-col"
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
                v-if="qrUrl"
                class="flex shrink-0 flex-col items-center gap-3 rounded-[2rem] bg-white p-6 shadow-lg ring ring-default"
            >
                <img
                    :src="qrUrl"
                    :alt="t('competitions.qrCode')"
                    class="size-[min(55vh,38vw)] portrait:size-[min(40vh,70vw)]"
                />
                <span class="text-xl font-semibold text-black">{{
                    shareHost
                }}</span>
            </div>
        </div>

        <TvCompetitionStandings v-else :results="results" />
    </TvShell>
</template>

<script setup lang="ts">
import { competitionPhase, competitionShareUrl } from '~/utils/competitions'
import { getCompetition } from '~/api/competitions'
import { qrDataUrl } from '~/utils/qrDataUrl'
import { coalesce } from '~/utils/realtimeCache'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

const { gym } = useGym()

const competitionId = computed(() => String(route.params.id ?? ''))
const qrUrl = ref('')
const now = ref<Date | null>(null)

const { data: competition, refresh } = await useAsyncData(
    () => `tv-competition:${competitionId.value}`,
    () => getCompetition(competitionId.value),
    { enabled: () => !!competitionId.value },
)

if (!competition.value || competition.value.gym !== useCurrentGymId().value)
    throw createError({ status: 404, fatal: true })

const { data: results } = useCompetitionResults(competitionId)
const refreshCompetitionSoon = coalesce(() => refresh(), 300)
useCompetitionLive(competitionId, ({ kind }) => {
    if (kind === 'competition' || kind === 'resync') refreshCompetitionSoon()
})

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
const shareHost = computed(() => `${requestUrl.host}/${gym.value?.slug ?? ''}`)

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

useHead({
    title: computed(() =>
        t('page.title.competition', { name: competition.value?.name ?? '' }),
    ),
})

let clockTimer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
    now.value = new Date()
    clockTimer = setInterval(() => (now.value = new Date()), 1000)
    qrUrl.value = await qrDataUrl(
        competitionShareUrl(
            requestUrl.origin,
            gym.value?.slug ?? '',
            competitionId.value,
        ),
    )
})
onBeforeUnmount(() => clearInterval(clockTimer))
</script>
