<template>
    <div class="flex flex-col gap-3" data-testid="competition-entries">
        <div class="flex flex-wrap items-center gap-2">
            <UInput
                v-model="search"
                icon="i-lucide-search"
                :placeholder="$t('competitions.searchEntries')"
                :aria-label="$t('competitions.searchEntries')"
                class="min-w-48 flex-1"
                data-testid="competition-entries-search"
            />
            <div class="flex flex-wrap gap-2">
                <UBadge color="neutral" variant="soft" size="lg">
                    {{
                        $t(
                            'competitions.entryCount',
                            { n: activeEntries.length },
                            activeEntries.length,
                        )
                    }}
                </UBadge>
                <UBadge color="success" variant="soft" size="lg">
                    {{
                        $t('competitions.checkedInCount', { n: checkedInCount })
                    }}
                </UBadge>
                <UBadge
                    v-if="requiresPayment"
                    color="info"
                    variant="soft"
                    size="lg"
                >
                    {{ $t('competitions.paidCount', { n: paidCount }) }}
                </UBadge>
            </div>
        </div>

        <LayoutEmptyState
            v-if="!entries?.length"
            icon="i-lucide-users"
            :title="$t('competitions.noEntries')"
        />
        <ul v-else class="flex flex-col gap-2">
            <li
                v-for="entry in visibleEntries"
                :key="entry.id"
                class="flex flex-wrap items-center gap-3 rounded-lg bg-default p-3 ring ring-default"
                :class="{ 'opacity-60': isInactive(entry) }"
                :data-testid="`competition-entry-${entry.bib}`"
            >
                <div
                    class="flex min-w-0 basis-full items-center gap-3 md:flex-1 md:basis-0"
                >
                    <span
                        class="w-10 text-center text-lg font-bold tabular-nums text-highlighted"
                        >{{ entry.bib }}</span
                    >
                    <div class="min-w-0 flex-1">
                        <p class="truncate font-medium text-highlighted">
                            {{ entry.display_name }}
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{ categoryName(entry) }} · {{ entry.birth_year }}
                        </p>
                    </div>
                </div>
                <UBadge
                    :color="STATUS_COLORS[entry.status]"
                    variant="soft"
                    :data-testid="`competition-entry-status-${entry.bib}`"
                >
                    {{ $t(`competitions.entryStatuses.${entry.status}`) }}
                </UBadge>
                <USwitch
                    v-if="requiresPayment"
                    :model-value="entry.paid"
                    :label="$t('competitions.paid')"
                    :data-testid="`competition-entry-paid-${entry.bib}`"
                    @update:model-value="(paid) => patch(entry, { paid })"
                />
                <UButton
                    v-if="entry.status === 'registered'"
                    icon="i-lucide-check"
                    color="success"
                    variant="soft"
                    :data-testid="`competition-entry-checkin-${entry.bib}`"
                    @click="patch(entry, { status: 'checked_in' })"
                >
                    {{ $t('competitions.checkIn') }}
                </UButton>
                <UDropdownMenu :items="menuItems(entry)">
                    <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn ms-auto md:ms-0"
                        :aria-label="$t('competitions.entryActions')"
                        :data-testid="`competition-entry-menu-${entry.bib}`"
                    />
                </UDropdownMenu>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { listEntries, updateEntry } from '~/api/competitions'
import type { DropdownMenuItem } from '@nuxt/ui'
import type {
    CompetitionCategoryRecord,
    CompetitionEntryRecord,
    CompetitionEntryStatus,
} from '~/types/models'

const STATUS_COLORS: Record<
    CompetitionEntryStatus,
    'neutral' | 'success' | 'error' | 'warning'
> = {
    registered: 'neutral',
    checked_in: 'success',
    disqualified: 'error',
    withdrawn: 'warning',
}

const props = defineProps<{
    competitionId: string
    requiresPayment?: boolean
}>()

const { t } = useI18n()
const { run } = useAsyncAction()

const search = ref('')

const { data: entries, refresh } = useAsyncData(
    () => `competition-entries:${props.competitionId}`,
    () => listEntries(props.competitionId),
    { deep: true },
)

const isInactive = (entry: CompetitionEntryRecord) =>
    entry.status === 'disqualified' || entry.status === 'withdrawn'

const activeEntries = computed(() =>
    (entries.value ?? []).filter((entry) => !isInactive(entry)),
)
const checkedInCount = computed(
    () =>
        activeEntries.value.filter((entry) => entry.status === 'checked_in')
            .length,
)
const paidCount = computed(
    () => activeEntries.value.filter((entry) => entry.paid).length,
)

const visibleEntries = computed(() => {
    const term = search.value.trim().toLowerCase()
    if (!term) return entries.value ?? []
    return (entries.value ?? []).filter(
        (entry) =>
            entry.display_name.toLowerCase().includes(term) ||
            String(entry.bib) === term,
    )
})

function categoryName(entry: CompetitionEntryRecord) {
    return (entry.expand?.category as CompetitionCategoryRecord | undefined)
        ?.name
}

function menuItems(entry: CompetitionEntryRecord): DropdownMenuItem[] {
    const setStatus = (status: CompetitionEntryStatus) => () =>
        patch(entry, { status })
    return [
        entry.status === 'checked_in'
            ? {
                  label: t('competitions.undoCheckIn'),
                  icon: 'i-lucide-undo-2',
                  onSelect: setStatus('registered'),
              }
            : null,
        isInactive(entry)
            ? {
                  label: t('competitions.reinstate'),
                  icon: 'i-lucide-rotate-ccw',
                  onSelect: setStatus('registered'),
                  'data-testid': `competition-entry-reinstate-${entry.bib}`,
              }
            : {
                  label: t('competitions.disqualify'),
                  icon: 'i-lucide-ban',
                  color: 'error' as const,
                  onSelect: setStatus('disqualified'),
                  'data-testid': `competition-entry-disqualify-${entry.bib}`,
              },
    ].filter((item) => item !== null)
}

async function patch(
    entry: CompetitionEntryRecord,
    changes: Partial<CompetitionEntryRecord>,
) {
    const previous = { ...entry }
    Object.assign(entry, changes)
    const saved = await run(() => updateEntry(entry.id, changes))
    if (!saved) Object.assign(entry, previous)
}

const refreshSoon = coalesce(() => refresh(), 400)
useCompetitionLive(
    computed(() => props.competitionId),
    ({ kind }) => {
        if (kind === 'entries' || kind === 'categories' || kind === 'resync') {
            refreshSoon()
        }
    },
)

defineExpose({ refresh })
</script>
