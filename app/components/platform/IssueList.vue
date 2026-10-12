<template>
    <LayoutPanel
        :title="t('platform.issues.title')"
        data-testid="platform-issues"
    >
        <template #actions>
            <SegmentedControl
                v-model="range"
                :items="rangeItems"
                size="sm"
                test-id="platform-issues-range"
            />
        </template>
        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <UEmpty
            v-else-if="!issues.length"
            icon="i-lucide-circle-check"
            :title="t('platform.issues.empty')"
            variant="naked"
            class="py-6"
        />
        <ul
            v-else
            class="-mx-4 -mb-4 divide-y divide-default border-t border-default"
        >
            <li
                v-for="issue in issues"
                :key="issue.fingerprint"
                :data-testid="`platform-issue-${issue.fingerprint}`"
            >
                <button
                    type="button"
                    class="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-sm outline-none hover:bg-elevated/60 focus-visible:bg-elevated"
                    :aria-expanded="open === issue.fingerprint"
                    @click="toggle(issue.fingerprint)"
                >
                    <UBadge
                        :color="logLevelColor(issue.level)"
                        variant="subtle"
                        size="sm"
                        class="font-semibold uppercase"
                    >
                        {{ logSeverity(issue.level) }}
                    </UBadge>
                    <UBadge
                        v-if="isNew(issue)"
                        color="primary"
                        variant="solid"
                        size="sm"
                    >
                        {{ t('platform.issues.new') }}
                    </UBadge>
                    <span
                        class="min-w-0 flex-1 truncate font-mono text-highlighted"
                    >
                        {{ issueTitle(issue) }}
                    </span>
                    <span class="text-xs text-muted tabular-nums">
                        {{ t('platform.issues.count', issue.count) }} ·
                        {{ t('platform.issues.users', issue.users) }} ·
                        {{ when(issue.last_seen) }}
                    </span>
                </button>
                <div
                    v-if="open === issue.fingerprint"
                    class="flex flex-col gap-2 px-4 pb-4"
                >
                    <p class="text-xs text-muted">
                        {{
                            t('platform.issues.firstSeen', {
                                time: when(issue.first_seen),
                            })
                        }}
                    </p>
                    <div
                        v-for="(entry, index) in occurrences"
                        :key="index"
                        class="rounded-md bg-muted p-3 font-mono text-xs ring ring-default"
                    >
                        <p class="mb-1 text-muted">
                            {{ when(entry.time) }} · {{ entry.replica }}
                        </p>
                        <dl
                            class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1"
                        >
                            <template
                                v-for="field in fields(entry)"
                                :key="field.name"
                            >
                                <dt class="text-muted">{{ field.name }}</dt>
                                <dd
                                    class="break-all whitespace-pre-wrap text-highlighted"
                                >
                                    {{ field.value }}
                                </dd>
                            </template>
                        </dl>
                    </div>
                </div>
            </li>
        </ul>
    </LayoutPanel>
</template>

<script setup lang="ts">
import {
    listIssueOccurrences,
    listIssues,
    type IssueRange,
    type ServerIssue,
    type ServerLogEntry,
} from '~/api/platform'
import { logLevelColor, logSeverity } from '~/utils/serverLogs'
import { issueTitle } from '~/utils/serverHealth'
import { formatDate } from '#shared/utils/formatting'

const { t, locale } = useI18n()
const route = useRoute()

const range = ref<IssueRange>('24h')
const open = ref<string | null>(
    typeof route.query.issue === 'string' ? route.query.issue : null,
)
const occurrences = ref<ServerLogEntry[]>([])

const { data, error } = useAsyncData(
    'platform-issues',
    () => listIssues(range.value),
    { server: false, watch: [range] },
)
const issues = computed(() => data.value?.items ?? [])

const rangeItems = computed(() =>
    (['1h', '24h', '7d'] as const).map((value) => ({
        value,
        label: t(`platform.issues.ranges.${value}`),
    })),
)

watch(
    open,
    async (fingerprint) => {
        occurrences.value = []
        if (!fingerprint || !import.meta.client) return
        occurrences.value = (await listIssueOccurrences(fingerprint)).items
    },
    { immediate: true },
)

function toggle(fingerprint: string) {
    open.value = open.value === fingerprint ? null : fingerprint
}

function isNew(issue: ServerIssue) {
    return Date.now() - Date.parse(issue.first_seen) < 24 * 3_600_000
}

function when(time: string) {
    return formatDate(time, { locale: locale.value, withTime: true })
}

function fields(entry: ServerLogEntry) {
    return Object.entries({ message: entry.message, ...entry.attrs }).map(
        ([name, value]) => ({
            name,
            value: typeof value === 'string' ? value : JSON.stringify(value),
        }),
    )
}
</script>
