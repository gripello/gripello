<template>
    <div class="mx-auto w-full p-4">
        <LayoutLoadingState
            v-if="status === 'pending' && !competition"
            variant="page"
        />
        <LayoutEmptyState
            v-else-if="error || !competition"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    data-testid="load-error-retry"
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>
        <template v-else>
            <LayoutPageHeader
                :title="competition.name"
                :subtitle="windowText"
                :back-to="gymPath('/manage/competitions')"
                :back-label="t('competitions.pageTitle')"
            >
                <template #actions>
                    <UButton
                        :to="
                            gymPath(
                                `/manage/competitions/${competition.id}/judge`,
                            )
                        "
                        icon="i-lucide-clipboard-pen"
                        color="neutral"
                        variant="outline"
                        data-testid="competition-judge"
                    >
                        {{ t('competitions.judge.open') }}
                    </UButton>
                    <UDropdownMenu :items="exportItems">
                        <UButton
                            icon="i-lucide-download"
                            color="neutral"
                            variant="outline"
                            :loading="exporting"
                            data-testid="competition-export"
                        >
                            {{ t('competitions.export.menu') }}
                        </UButton>
                    </UDropdownMenu>
                    <UDropdownMenu :items="moreItems">
                        <UButton
                            icon="i-lucide-ellipsis-vertical"
                            color="neutral"
                            variant="ghost"
                            class="icon-btn"
                            :loading="copying"
                            :aria-label="t('competitions.more')"
                            data-testid="competition-more"
                        />
                    </UDropdownMenu>
                </template>
            </LayoutPageHeader>

            <CompetitionLifecycle
                :competition="competition"
                :checklist="checklist"
                :pending="pending"
                @goto="gotoStep"
                @status="setStatus"
            />

            <LayoutTabs
                v-model="activeTab"
                :items="tabs"
                data-testid="competition-tabs"
            >
                <template #routes>
                    <CompetitionRouteEditor
                        class="mt-4"
                        :competition="competition"
                        @changed="refreshSetup"
                    />
                </template>
                <template #categories>
                    <CompetitionCategoryEditor
                        class="mt-4"
                        :competition-id="competition.id"
                        @changed="refreshSetup"
                    />
                </template>
                <template #results>
                    <div class="mt-4 flex flex-col gap-3">
                        <div class="flex justify-end">
                            <UButton
                                :to="
                                    gymPath(
                                        `/competitions/${competition.id}/tv`,
                                    )
                                "
                                target="_blank"
                                icon="i-lucide-tv"
                                color="neutral"
                                variant="outline"
                                data-testid="competition-manage-tv"
                            >
                                {{ t('competitions.standings.tv') }}
                            </UButton>
                        </div>
                        <CompetitionStandings :results="staffResults" />
                    </div>
                </template>
                <template #entries>
                    <CompetitionEntryList
                        class="mt-4"
                        :competition-id="competition.id"
                        :requires-payment="competition.requires_payment"
                    />
                </template>
            </LayoutTabs>

            <CompetitionFormDialog
                v-model="formOpen"
                :competition="competition"
                @saved="(saved) => (competition = saved)"
            />
            <CompetitionExportDialog
                v-model="exportOpen"
                :request="exportRequest"
                :loading="exporting"
                @confirm="runExport"
            />
            <ConfirmDialog
                v-model="deleteOpen"
                :title="t('competitions.deleteTitle')"
                :message="t('competitions.deleteMessage')"
                :confirm-text="t('actions.delete')"
                :loading="pending"
                @confirm="remove"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import type { LocaleCode } from '~/utils/locales'
import type {
    CompetitionExportFormat,
    CompetitionExportKind,
} from '~/composables/useCompetitionExport'
import {
    copiedCompetition,
    formatCompetitionWindow,
    setupChecklist,
    type SetupStep,
} from '~/utils/competitions'
import type {
    CompetitionCategoryRecord,
    CompetitionRecord,
    CompetitionRouteRecord,
    CompetitionStatus,
} from '~/types/models'

const gymPath = useGymPath()

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_competitions',
})

const { t, locale } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const { pending, run } = useAsyncAction()
const { pending: exporting, download } = useCompetitionExport()

const formOpen = ref(false)
const deleteOpen = ref(false)
const copying = ref(false)

const competitionId = computed(() => String(route.params.id ?? ''))

const {
    data: competition,
    status,
    error,
    refresh,
} = await useAsyncData(
    () => `manage-competition:${competitionId.value}`,
    () =>
        pb
            .collection('competitions')
            .getOne<CompetitionRecord>(competitionId.value),
    { enabled: () => !!competitionId.value },
)

if (competition.value && competition.value.gym !== useCurrentGymId().value)
    throw createError({ status: 404, fatal: true })

const { data: setup, refresh: refreshSetup } = useAsyncData(
    () => `manage-competition-setup:${competitionId.value}`,
    async () => {
        const filter = pb.filter('competition = {:id}', {
            id: competitionId.value,
        })
        const [categories, routes] = await Promise.all([
            pb
                .collection('competition_categories')
                .getList(1, 1, { filter, requestKey: null }),
            pb
                .collection('competition_routes')
                .getFullList<CompetitionRouteRecord>({
                    filter,
                    fields: 'points,hold_count,voided',
                    requestKey: null,
                }),
        ])
        return { categoryCount: categories.totalItems, routes }
    },
    { enabled: () => !!competitionId.value },
)

const refreshCompetitionSoon = coalesce(() => refresh(), 400)
const refreshSetupSoon = coalesce(() => refreshSetup(), 400)
useCompetitionLive(competitionId, ({ kind }) => {
    if (kind === 'competition' || kind === 'resync') refreshCompetitionSoon()
    if (kind === 'routes' || kind === 'categories' || kind === 'resync') {
        refreshSetupSoon()
    }
})

const checklist = computed(() =>
    competition.value
        ? setupChecklist({
              competition: competition.value,
              categoryCount: setup.value?.categoryCount ?? 0,
              routes: setup.value?.routes ?? [],
          })
        : [],
)

const activeTab = ref<'routes' | 'categories' | 'entries' | 'results'>(
    competition.value?.status === 'draft' ? 'routes' : 'entries',
)

function gotoStep(step: SetupStep) {
    if (step === 'details') formOpen.value = true
    else activeTab.value = step === 'categories' ? 'categories' : 'routes'
}

const tabs = computed(() => [
    {
        label: t(
            `competitions.items.${competition.value?.discipline ?? 'boulder'}.tab`,
        ),
        value: 'routes' as const,
        slot: 'routes' as const,
        icon:
            competition.value?.discipline === 'rope'
                ? 'i-lucide-cable'
                : 'i-lucide-mountain',
    },
    {
        label: t('competitions.categories'),
        value: 'categories' as const,
        slot: 'categories' as const,
        icon: 'i-lucide-tags',
    },
    {
        label: t('competitions.entries'),
        value: 'entries' as const,
        slot: 'entries' as const,
        icon: 'i-lucide-users',
    },
    {
        label: t('competitions.standings.title'),
        value: 'results' as const,
        slot: 'results' as const,
        icon: 'i-lucide-trophy',
    },
])

const EXPORTS = [
    ['results', 'pdf', 'i-lucide-file-text'],
    ['results', 'xlsx', 'i-lucide-sheet'],
    ['startlist', 'pdf', 'i-lucide-file-text'],
    ['startlist', 'xlsx', 'i-lucide-sheet'],
    ['certificates', 'pdf', 'i-lucide-award'],
] as const

const exportRequest = ref<{
    kind: CompetitionExportKind
    format: CompetitionExportFormat
} | null>(null)
const exportOpen = ref(false)

const exportItems = computed(() =>
    EXPORTS.map(([kind, format, icon]) => ({
        label: `${t(`competitions.export.kinds.${kind}`)} (${format.toUpperCase()})`,
        icon,
        'data-testid': `competition-export-${kind}-${format}`,
        onSelect: () => {
            exportRequest.value = { kind, format }
            exportOpen.value = true
        },
    })),
)

async function runExport(exportLocale: LocaleCode) {
    if (!competition.value || !exportRequest.value) return
    const { kind, format } = exportRequest.value
    if (await download(competition.value, kind, format, exportLocale)) {
        exportOpen.value = false
    }
}

const moreItems = computed(() => [
    [
        {
            label: t('actions.edit'),
            icon: 'i-lucide-pencil',
            'data-testid': 'competition-edit',
            onSelect: () => {
                formOpen.value = true
            },
        },
        {
            label: t('competitions.copy'),
            icon: 'i-lucide-copy',
            'data-testid': 'competition-copy',
            onSelect: () => void copy(),
        },
    ],
    [
        {
            label: t('actions.delete'),
            icon: 'i-lucide-trash-2',
            color: 'error' as const,
            'data-testid': 'competition-delete',
            onSelect: () => {
                deleteOpen.value = true
            },
        },
    ],
])

const { data: staffResults } = useCompetitionResults(competitionId, {
    staff: true,
})

const windowText = computed(() =>
    competition.value
        ? formatCompetitionWindow(competition.value, locale.value)
        : '',
)

useHead({
    title: computed(() =>
        t('page.title.competition', { name: competition.value?.name ?? '' }),
    ),
})

async function setStatus(next: CompetitionStatus) {
    const current = competition.value
    if (!current || current.status === next) return
    const updated = await run(
        () =>
            pb
                .collection('competitions')
                .update<CompetitionRecord>(current.id, { status: next }),
        { success: t('competitions.saved') },
    )
    if (updated) competition.value = updated
}

async function copy() {
    const source = competition.value
    if (!source) return
    copying.value = true
    const created = await run(async () => {
        const copied = await pb
            .collection('competitions')
            .create<CompetitionRecord>(
                copiedCompetition(
                    source,
                    t('competitions.copyName', { name: source.name }),
                ),
            )
        const categories = await pb
            .collection('competition_categories')
            .getFullList<CompetitionCategoryRecord>({
                filter: pb.filter('competition = {:id}', { id: source.id }),
            })
        await Promise.all(
            categories.map(
                ({ name, gender, min_birth_year, max_birth_year, sort }) =>
                    pb.collection('competition_categories').create(
                        {
                            competition: copied.id,
                            name,
                            gender,
                            min_birth_year,
                            max_birth_year,
                            sort,
                        },
                        { requestKey: null },
                    ),
            ),
        )
        return copied
    })
    copying.value = false
    if (created) await navigateTo(gymPath(`/manage/competitions/${created.id}`))
}

async function remove() {
    const current = competition.value
    if (!current) return
    await run(async () => {
        await pb.collection('competitions').delete(current.id)
        deleteOpen.value = false
        await navigateTo(gymPath('/manage/competitions'))
    })
}
</script>
