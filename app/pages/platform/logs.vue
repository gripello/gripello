<template>
    <div class="w-full p-4">
        <LayoutPageHeader :title="t('platform.logs.title')">
            <template #actions>
                <UButton
                    color="neutral"
                    variant="outline"
                    data-testid="platform-logs-live"
                    @click="live = !live"
                >
                    <span class="relative flex size-2">
                        <span
                            v-if="live"
                            class="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75"
                        />
                        <span
                            class="relative inline-flex size-2 rounded-full"
                            :class="live ? 'bg-primary' : 'bg-accented'"
                        />
                    </span>
                    {{
                        live
                            ? t('platform.logs.live')
                            : t('platform.logs.paused')
                    }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <div v-else class="flex flex-col gap-4">
            <PlatformIssueList />
            <div
                class="grid grid-cols-2 gap-3 max-lg:hidden lg:grid-cols-4"
                data-testid="platform-logs-counts"
            >
                <button
                    v-for="card in countCards"
                    :key="card.value"
                    type="button"
                    class="flex flex-col gap-1 rounded-lg bg-default p-4 text-left ring transition-shadow"
                    :class="
                        filter === card.value
                            ? 'ring-2 ring-primary'
                            : 'ring-default hover:ring-accented'
                    "
                    :aria-pressed="filter === card.value"
                    :data-testid="`platform-logs-count-${card.value}`"
                    @click="filter = card.value"
                >
                    <span class="flex items-center gap-2 text-sm text-muted">
                        <span class="size-2 rounded-full" :class="card.dot" />
                        {{ card.label }}
                    </span>
                    <span
                        class="text-2xl font-bold tabular-nums text-highlighted"
                    >
                        {{ logs ? formatNumber(card.count) : '—' }}
                    </span>
                    <span class="text-xs text-muted">
                        {{ t('platform.logs.inBuffer') }}
                    </span>
                </button>
            </div>

            <section
                class="rounded-lg bg-default p-4 ring ring-default max-lg:hidden"
                data-testid="platform-logs-histogram"
            >
                <div class="mb-4 flex flex-wrap items-center gap-3">
                    <h2 class="flex-1 text-base font-semibold text-highlighted">
                        {{ t('platform.logs.perMinute') }}
                    </h2>
                    <span
                        v-for="item in legend"
                        :key="item.label"
                        class="flex items-center gap-1.5 text-xs text-muted"
                    >
                        <span class="size-2.5 rounded-sm" :class="item.color" />
                        {{ item.label }}
                    </span>
                </div>
                <div class="flex h-24 items-end gap-1" aria-hidden="true">
                    <div
                        v-for="(bucket, index) in histogram"
                        :key="index"
                        class="flex h-full flex-1 flex-col justify-end gap-0.5"
                    >
                        <span
                            v-if="bucket.error"
                            class="rounded-sm bg-error"
                            :style="{ height: barHeight(bucket.error) }"
                        />
                        <span
                            v-if="bucket.warn"
                            class="rounded-sm bg-warning"
                            :style="{ height: barHeight(bucket.warn) }"
                        />
                        <span
                            class="rounded-sm"
                            :class="
                                bucket.info ? 'bg-primary/35' : 'bg-elevated'
                            "
                            :style="{
                                height: bucket.info
                                    ? barHeight(bucket.info)
                                    : '3px',
                            }"
                        />
                    </div>
                </div>
                <div
                    class="mt-2 flex justify-between font-mono text-[11px] text-muted"
                >
                    <span v-for="tick in axisTicks" :key="tick">{{
                        tick
                    }}</span>
                </div>
            </section>

            <div
                class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
            >
                <section
                    class="min-w-0 overflow-hidden rounded-lg bg-default ring ring-default"
                    data-testid="platform-logs"
                >
                    <div
                        class="flex flex-wrap items-center gap-3 border-b border-default p-3"
                    >
                        <UInput
                            ref="searchInput"
                            v-model="query"
                            icon="i-lucide-search"
                            :placeholder="t('platform.logs.search')"
                            size="lg"
                            class="min-w-48 flex-1"
                            data-testid="platform-logs-search"
                        >
                            <template #trailing>
                                <UKbd value="/" class="max-lg:hidden" />
                            </template>
                        </UInput>
                        <SegmentedControl
                            v-model="filter"
                            :items="filterItems"
                            size="sm"
                            test-id="platform-logs-filter"
                        />
                    </div>

                    <LayoutLoadingState v-if="!logs" />
                    <UEmpty
                        v-else-if="!visible.length"
                        icon="i-lucide-scroll-text"
                        :title="t('platform.logs.empty')"
                        variant="naked"
                        class="py-16"
                    />
                    <ul
                        v-else
                        class="divide-y divide-default lg:max-h-[70vh] lg:overflow-y-auto"
                        data-testid="platform-logs-list"
                    >
                        <li
                            v-for="entry in visible"
                            :key="entry.key"
                            :class="{
                                'bg-error/5': entry.severity === 'error',
                                'bg-elevated/50': expanded === entry.key,
                            }"
                        >
                            <button
                                type="button"
                                class="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-left font-mono text-xs outline-none hover:bg-elevated/60 focus-visible:bg-elevated max-md:py-3 md:flex-nowrap"
                                :aria-expanded="expanded === entry.key"
                                @click="toggle(entry.key)"
                            >
                                <span
                                    class="w-16 shrink-0 text-muted max-md:w-auto"
                                >
                                    {{ clock(entry.time) }}
                                </span>
                                <UBadge
                                    :color="logLevelColor(entry.level)"
                                    variant="subtle"
                                    size="sm"
                                    class="w-14 shrink-0 justify-center font-semibold uppercase max-md:-order-1"
                                >
                                    {{ entry.severity }}
                                </UBadge>
                                <UBadge
                                    v-if="entry.module"
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    class="shrink-0 font-mono max-md:ml-auto"
                                >
                                    {{ entry.module }}
                                </UBadge>
                                <span
                                    class="min-w-0 flex-1 text-highlighted max-md:order-last max-md:basis-full max-md:font-sans max-md:text-sm max-md:break-words md:truncate"
                                >
                                    {{ entry.message }}
                                </span>
                                <span
                                    class="shrink-0 text-muted"
                                    :class="{ 'max-md:ml-auto': !entry.module }"
                                >
                                    {{ entry.replica }}
                                </span>
                            </button>
                            <div
                                v-if="expanded === entry.key"
                                class="flex flex-col gap-3 px-4 pb-4 sm:pl-[6.5rem]"
                            >
                                <p
                                    class="font-mono text-xs break-words whitespace-pre-wrap text-highlighted max-md:hidden"
                                >
                                    {{ entry.message }}
                                </p>
                                <dl
                                    v-if="fields(entry).length"
                                    class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 rounded-md bg-muted p-3 font-mono text-xs ring ring-default"
                                >
                                    <template
                                        v-for="field in fields(entry)"
                                        :key="field.name"
                                    >
                                        <dt class="text-muted">
                                            {{ field.name }}
                                        </dt>
                                        <dd class="break-all text-highlighted">
                                            {{ field.value }}
                                        </dd>
                                    </template>
                                </dl>
                                <div class="flex flex-wrap gap-2">
                                    <UButton
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        icon="i-lucide-copy"
                                        data-testid="platform-logs-copy"
                                        @click="copyEntry(entry)"
                                    >
                                        {{ t('platform.logs.copyJson') }}
                                    </UButton>
                                    <UButton
                                        v-if="entry.module"
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        icon="i-lucide-filter"
                                        @click="query = `${entry.module}:`"
                                    >
                                        {{ t('platform.logs.sameModule') }}
                                    </UButton>
                                </div>
                            </div>
                        </li>
                    </ul>
                </section>

                <div class="flex flex-col gap-4">
                    <section
                        class="rounded-lg bg-default p-4 ring ring-default"
                    >
                        <h2
                            class="mb-3 text-base font-semibold text-highlighted"
                        >
                            {{ t('platform.logs.runtimeLevel') }}
                        </h2>
                        <URadioGroup
                            :model-value="runtimeLevel"
                            :items="runtimeItems"
                            variant="card"
                            :disabled="saving"
                            :ui="{ fieldset: 'gap-2', item: 'items-center' }"
                            data-testid="platform-logs-runtime-level"
                            @update:model-value="
                                (level) => changeLevel(level as LogLevel)
                            "
                        />
                    </section>
                    <section
                        v-if="replicaRows.length"
                        class="rounded-lg bg-default p-4 ring ring-default"
                        data-testid="platform-logs-replicas"
                    >
                        <h2
                            class="mb-3 text-base font-semibold text-highlighted"
                        >
                            {{ t('platform.logs.replicas') }}
                        </h2>
                        <ul class="flex flex-col gap-1">
                            <li
                                v-for="replica in replicaRows"
                                :key="replica.name"
                            >
                                <button
                                    type="button"
                                    class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-elevated"
                                    :class="{
                                        'bg-elevated':
                                            replicaFilter === replica.name,
                                    }"
                                    :aria-pressed="
                                        replicaFilter === replica.name
                                    "
                                    :data-testid="`platform-logs-replica-${replica.name}`"
                                    @click="
                                        replicaFilter =
                                            replicaFilter === replica.name
                                                ? ''
                                                : replica.name
                                    "
                                >
                                    <span
                                        class="size-2 shrink-0 rounded-full"
                                        :class="REPLICA_DOT[replica.status]"
                                        role="img"
                                        :aria-label="
                                            t(
                                                `platform.logs.replicaStatus.${replica.status}`,
                                            )
                                        "
                                        :data-status="replica.status"
                                    />
                                    <span
                                        class="min-w-0 flex-1 truncate font-mono"
                                    >
                                        {{ replica.name }}
                                    </span>
                                    <span class="text-muted">
                                        {{
                                            t(
                                                'platform.logs.lineCount',
                                                replica.lines,
                                            )
                                        }}
                                    </span>
                                </button>
                            </li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { copyText } from '~/utils/clipboard'
import { listServerLogs, setLogLevel, type LogLevel } from '~/api/platform'
import {
    filterLogs,
    logHistogram,
    logLevelColor,
    logLevelCounts,
    logModule,
    logReplicas,
    logSeverity,
    type LogSeverity,
    type ReplicaStatus,
} from '~/utils/serverLogs'

definePageMeta({ middleware: ['auth'], platformAdmin: true })

const { t, locale } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()

useHead({ title: () => t('platform.logs.title') })

const MINUTES = 30

const filter = ref<LogSeverity>('debug')
const query = ref('')
const replicaFilter = ref('')
const live = ref(true)
const expanded = ref<string | null>(null)
const searchInput = useTemplateRef<{ inputRef?: HTMLInputElement }>(
    'searchInput',
)

defineShortcuts({ '/': () => searchInput.value?.inputRef?.focus() })

const {
    data: logs,
    error,
    refresh,
} = await useAsyncData('platform-logs', () => listServerLogs('debug'), {
    server: false,
})

let timer: ReturnType<typeof setInterval> | undefined
watch(
    live,
    (on) => {
        clearInterval(timer)
        if (on && import.meta.client) timer = setInterval(() => refresh(), 5000)
    },
    { immediate: true },
)
onBeforeUnmount(() => clearInterval(timer))

const lines = computed(() =>
    (logs.value?.items ?? []).map((entry) => ({
        ...entry,
        key: `${entry.time}|${entry.replica}|${entry.level}|${entry.message}`,
        severity: logSeverity(entry.level),
        module: logModule(entry),
    })),
)
type LogRow = (typeof lines.value)[number]

const counts = computed(() => logLevelCounts(lines.value))
const replicaRows = computed(() =>
    logReplicas(lines.value, logs.value?.replicas ?? []),
)

const REPLICA_DOT: Record<ReplicaStatus, string> = {
    online: 'bg-success',
    offline: 'bg-error',
    gone: 'bg-accented',
}
const visible = computed(() =>
    filterLogs(
        lines.value,
        filter.value,
        query.value,
        replicaFilter.value,
    ).slice(0, 500),
)
const histogram = computed(() => logHistogram(lines.value, MINUTES))
const histogramMax = computed(() =>
    Math.max(4, ...histogram.value.map((b) => b.info + b.warn + b.error)),
)

function barHeight(count: number) {
    return `${Math.max(8, (count / histogramMax.value) * 100)}%`
}

const axisTicks = computed(() => {
    const now = Date.now()
    const format = new Intl.DateTimeFormat(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
    })
    return [MINUTES, 20, 10]
        .map((ago) => format.format(now - ago * 60_000))
        .concat(t('platform.logs.now'))
})

const legend = computed(() => [
    { label: t('platform.logs.levels.info'), color: 'bg-primary/35' },
    { label: t('platform.logs.levels.warn'), color: 'bg-warning' },
    { label: t('platform.logs.levels.error'), color: 'bg-error' },
])

const countCards = computed(() => [
    {
        value: 'debug' as const,
        label: t('platform.logs.allLines'),
        count: lines.value.length,
        dot: 'bg-accented',
    },
    {
        value: 'info' as const,
        label: t('platform.logs.levels.info'),
        count: counts.value.info,
        dot: 'bg-primary',
    },
    {
        value: 'warn' as const,
        label: t('platform.logs.levels.warn'),
        count: counts.value.warn,
        dot: 'bg-warning',
    },
    {
        value: 'error' as const,
        label: t('platform.logs.levels.error'),
        count: counts.value.error,
        dot: 'bg-error',
    },
])

const filterItems = computed(() =>
    (
        [
            ['debug', 'platform.logs.filterAll'],
            ['info', 'platform.logs.filterInfo'],
            ['warn', 'platform.logs.filterWarn'],
            ['error', 'platform.logs.levels.error'],
        ] as const
    ).map(([value, label]) => ({
        value,
        label: `${t(label)} · ${formatNumber(filterLogs(lines.value, value, '').length)}`,
    })),
)

onMounted(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) filter.value = 'warn'
})

const runtimeItems = computed(() =>
    (['debug', 'info', 'warn', 'error'] as const).map((value) => ({
        value,
        label: t(`platform.logs.levels.${value}`),
        description:
            value === 'debug'
                ? t('platform.logs.verbose')
                : value === 'info'
                  ? t('platform.logs.default')
                  : undefined,
    })),
)

function formatNumber(value: number) {
    return new Intl.NumberFormat(locale.value).format(value)
}

function clock(time: string) {
    return new Intl.DateTimeFormat(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date(time))
}

function toggle(key: string) {
    expanded.value = expanded.value === key ? null : key
}

function fields(entry: LogRow) {
    return Object.entries(entry.attrs ?? {}).map(([name, value]) => ({
        name,
        value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
}

async function copyEntry(entry: LogRow) {
    const { time, replica, level, message, attrs } = entry
    if (
        await copyText(
            JSON.stringify(
                { time, replica, level, message, ...attrs },
                null,
                2,
            ),
        )
    )
        notifySuccess(t('platform.logs.copied'))
    else notifyError(t('notifications.error.generic'))
}

const runtimeLevel = computed(
    () => (logs.value?.level?.toLowerCase() ?? 'info') as LogLevel,
)

const { pending: saving, run } = useAsyncAction()

async function changeLevel(level: LogLevel) {
    await run(
        async () => {
            await setLogLevel(level)
            await refresh()
        },
        { success: t('platform.logs.levelChanged') },
    )
}
</script>
