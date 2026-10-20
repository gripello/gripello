<template>
    <LayoutDialogShell
        v-model="open"
        :title="
            competition
                ? $t('competitions.editTitle')
                : $t('competitions.newTitle')
        "
        max-width="600"
        closable
        scrollable
        sheet-on-mobile
        data-testid="competition-form-dialog"
        :submit-label="$t('actions.save')"
        submit-icon="i-lucide-check"
        :submit-loading="pending"
        submit-test-id="competition-form-save"
        cancel-test-id="competition-form-cancel"
        @submit="save"
    >
        <UForm
            ref="formRef"
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            class="flex flex-col gap-5"
            @submit.prevent
        >
            <UFormField :label="$t('competitions.name')" name="name">
                <UInput
                    v-model="form.name"
                    size="lg"
                    class="w-full"
                    data-testid="competition-form-name"
                />
            </UFormField>

            <UFormField
                :label="$t('competitions.description')"
                name="description"
            >
                <UTextarea
                    v-model="form.description"
                    :rows="3"
                    :maxlength="5000"
                    autoresize
                    class="w-full"
                    data-testid="competition-form-description"
                />
            </UFormField>

            <UFormField
                v-if="locationItems.length > 1"
                :label="$t('competitions.location')"
                name="location"
            >
                <USelect
                    v-model="form.location"
                    :items="locationItems"
                    icon="i-lucide-map-pin"
                    class="w-full"
                    data-testid="competition-form-location"
                />
            </UFormField>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <UFormField
                    :label="$t('competitions.startsAt')"
                    name="startsAt"
                >
                    <UInput
                        v-model="form.startsAt"
                        type="datetime-local"
                        class="w-full"
                        data-testid="competition-form-starts"
                    />
                </UFormField>
                <UFormField :label="$t('competitions.endsAt')" name="endsAt">
                    <UInput
                        v-model="form.endsAt"
                        type="datetime-local"
                        class="w-full"
                        data-testid="competition-form-ends"
                    />
                </UFormField>
            </div>

            <USwitch
                v-model="form.requiresPayment"
                :label="$t('competitions.requiresPayment')"
                data-testid="competition-form-requires-payment"
            />
            <UFormField
                v-if="form.requiresPayment"
                :label="$t('competitions.registrationUrl')"
                name="registrationUrl"
            >
                <UInput
                    v-model="form.registrationUrl"
                    type="url"
                    icon="i-lucide-link"
                    placeholder="https://"
                    class="w-full"
                    data-testid="competition-form-registration-url"
                />
            </UFormField>

            <USeparator :label="$t('competitions.scoring')" />

            <UFormField :label="$t('competitions.discipline')">
                <OptionGrid
                    :model-value="form.discipline"
                    :items="disciplineItems"
                    :disabled="!!competition"
                    :label="$t('competitions.discipline')"
                    test-id-prefix="competition-form-discipline"
                    @update:model-value="selectDiscipline"
                />
            </UFormField>

            <UFormField :label="$t('competitions.format')">
                <OptionGrid
                    v-model="form.format"
                    :items="formatItems"
                    cols="grid-cols-1 sm:grid-cols-2"
                    :label="$t('competitions.format')"
                    test-id-prefix="competition-form-format"
                />
                <p class="mt-2 text-xs text-muted">
                    {{ $t(formatHintKey) }}
                </p>
            </UFormField>

            <div
                v-if="form.format === 'dynamic'"
                class="grid grid-cols-1 gap-4"
                :class="{ 'sm:grid-cols-2': form.discipline === 'boulder' }"
            >
                <UFormField :label="$t(`${itemKey}.topPool`)" name="topPool">
                    <UInputNumber
                        v-model="form.topPool"
                        :min="1"
                        class="w-full"
                        data-testid="competition-form-top-pool"
                    />
                </UFormField>
                <UFormField
                    v-if="form.discipline === 'boulder'"
                    :label="$t('competitions.zonePool')"
                    name="zonePool"
                >
                    <UInputNumber
                        v-model="form.zonePool"
                        :min="0"
                        class="w-full"
                        data-testid="competition-form-zone-pool"
                    />
                </UFormField>
            </div>

            <UFormField
                v-if="form.format === 'route_points'"
                :label="$t('competitions.topropeFactor')"
                name="topropePercent"
            >
                <UInputNumber
                    v-model="form.topropePercent"
                    :min="0"
                    :max="100"
                    :format-options="{ style: 'unit', unit: 'percent' }"
                    class="w-full"
                    data-testid="competition-form-toprope"
                />
            </UFormField>

            <UFormField
                v-if="usesFlashBonus"
                :label="$t('competitions.flashBonus')"
                name="flashBonus"
            >
                <UInputNumber
                    v-model="form.flashBonus"
                    :min="0"
                    :max="100"
                    :format-options="{ style: 'unit', unit: 'percent' }"
                    class="w-full"
                    data-testid="competition-form-flash-bonus"
                />
            </UFormField>

            <USwitch
                v-if="usesBestOf"
                v-model="form.bestOfEnabled"
                :label="$t(`${itemKey}.bestOfToggle`)"
                data-testid="competition-form-best-of-toggle"
            />
            <UFormField
                v-if="usesBestOf && form.bestOfEnabled"
                :label="$t(`${itemKey}.bestOf`)"
                name="bestOf"
            >
                <UInputNumber
                    v-model="form.bestOf"
                    :min="1"
                    class="w-full"
                    data-testid="competition-form-best-of"
                />
            </UFormField>

            <USeparator :label="$t('competitions.results')" />

            <USwitch
                v-model="form.liveRanking"
                :label="$t('competitions.liveRanking')"
                data-testid="competition-form-live"
            />
            <UFormField
                v-if="form.liveRanking"
                :label="$t('competitions.freezeMinutes')"
                name="freezeMinutes"
            >
                <UInputNumber
                    v-model="form.freezeMinutes"
                    :min="0"
                    :max="600"
                    class="w-full"
                    data-testid="competition-form-freeze"
                />
            </UFormField>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { translatedItems } from '~/utils/translatedItems'
import {
    createCompetitionCategory,
    createCompetition,
    updateCompetition,
} from '~/api/competitions'
import { maxLength, nonBlank, validateRules } from '~/utils/validation'
import { formFieldErrors } from '~/utils/fieldErrors'
import {
    defaultCategories,
    fromDateTimeInput,
    suggestedEnd,
    toDateTimeInput,
} from '~/utils/competitions'
import {
    DEFAULT_TOP_POOL,
    DEFAULT_TOPROPE_FACTOR,
    COMPETITION_DISCIPLINES,
    FORMATS_BY_DISCIPLINE,
    type CompetitionDiscipline,
    type ScoringFormat,
} from '#shared/utils/competitionScoring'
import type { CompetitionRecord } from '~/types/models'

const DEFAULT_FREEZE_MINUTES = 15
const DEFAULT_BEST_OF = 5
const DEFAULT_START_HOUR = 10

const DISCIPLINE_ICONS: Record<CompetitionDiscipline, string> = {
    boulder: 'i-lucide-mountain',
    rope: 'i-lucide-cable',
}

const props = defineProps<{ competition?: CompetitionRecord | null }>()

const emit = defineEmits<{ saved: [competition: CompetitionRecord] }>()

const open = defineModel<boolean>({ default: false })

const gymId = useCurrentGymId()
const { t } = useI18n()
const { pending, run } = useAsyncAction()
const { data: locationRecords, items: locationItems } = useLocations()

const formRef = ref<{
    validate: (opts: { silent: boolean }) => Promise<unknown>
    setErrors: (errors: { name: string; message: string }[]) => void
}>()
let draft: { competition: CompetitionRecord; categories: number } | null = null

const form = reactive({
    name: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    registrationUrl: '',
    requiresPayment: false,
    discipline: 'boulder' as CompetitionDiscipline,
    format: 'dynamic' as ScoringFormat,
    flashBonus: 0,
    topropePercent: DEFAULT_TOPROPE_FACTOR * 100,
    topPool: DEFAULT_TOP_POOL,
    zonePool: 0,
    bestOf: DEFAULT_BEST_OF,
    bestOfEnabled: false,
    liveRanking: true,
    freezeMinutes: DEFAULT_FREEZE_MINUTES,
})

const formRules = computed(() => ({
    name: [nonBlank(t), maxLength(t, 200)],
    description: [maxLength(t, 5000)],
    location: [nonBlank(t)],
    registrationUrl: [
        maxLength(t, 500),
        (value: unknown) =>
            !value ||
            /^https?:\/\/\S+$/.test(String(value)) ||
            t('competitions.invalidUrl'),
    ],
    startsAt: [nonBlank(t)],
    endsAt: [
        nonBlank(t),
        (value: unknown) =>
            !form.startsAt ||
            String(value) > form.startsAt ||
            t('competitions.endsBeforeStart'),
    ],
}))

const formats = computed(() => FORMATS_BY_DISCIPLINE[form.discipline])

const disciplineItems = computed(() =>
    COMPETITION_DISCIPLINES.map((discipline) => ({
        value: discipline,
        label: t(`competitions.disciplines.${discipline}`),
        icon: DISCIPLINE_ICONS[discipline],
    })),
)

const formatItems = computed(() =>
    translatedItems(formats.value, 'competitions.formats', t),
)
const itemKey = computed(() => `competitions.items.${form.discipline}`)
const formatHintKey = computed(() =>
    form.format === 'dynamic'
        ? `${itemKey.value}.dynamicHint`
        : `competitions.formatHints.${form.format}`,
)
const usesFlashBonus = computed(() =>
    ['dynamic', 'fixed', 'route_points'].includes(form.format),
)
const usesBestOf = computed(
    () => form.format !== 'tops' && form.format !== 'lead_height',
)

function tomorrowAt(hour: number) {
    const date = new Date()
    date.setDate(date.getDate() + 1)
    date.setHours(hour, 0, 0, 0)
    return toDateTimeInput(date.toISOString())
}

watch(
    () => form.startsAt,
    (startsAt) => (form.endsAt = suggestedEnd(startsAt, form.endsAt)),
)

function selectDiscipline(discipline: CompetitionDiscipline) {
    form.discipline = discipline
    if (!formats.value.includes(form.format)) form.format = formats.value[0]!
}

watch(open, (isOpen) => {
    if (!isOpen) return
    const competition = props.competition
    if (competition) draft = null
    Object.assign(form, {
        name: competition?.name ?? '',
        description: competition?.description ?? '',
        location: competition?.location || locationRecords.value[0]?.id || '',
        startsAt: competition
            ? toDateTimeInput(competition.starts_at)
            : tomorrowAt(DEFAULT_START_HOUR),
        endsAt: toDateTimeInput(competition?.ends_at),
        registrationUrl: competition?.registration_url ?? '',
        requiresPayment: competition?.requires_payment ?? false,
        discipline: competition?.discipline ?? 'boulder',
        format: competition?.scoring_format ?? 'dynamic',
        flashBonus: competition?.scoring?.flashBonus ?? 0,
        topropePercent:
            (competition?.scoring?.topropeFactor ?? DEFAULT_TOPROPE_FACTOR) *
            100,
        topPool: competition?.scoring?.topPool ?? DEFAULT_TOP_POOL,
        zonePool: competition?.scoring?.zonePool ?? 0,
        bestOf: competition?.scoring?.bestOf || DEFAULT_BEST_OF,
        bestOfEnabled: !!competition?.scoring?.bestOf,
        liveRanking: competition?.live_ranking ?? true,
        freezeMinutes: competition?.freeze_minutes ?? DEFAULT_FREEZE_MINUTES,
    })
})

function buildBody() {
    return {
        name: form.name.trim(),
        description: form.description.trim(),
        location: form.location,
        starts_at: fromDateTimeInput(form.startsAt),
        ends_at: fromDateTimeInput(form.endsAt),
        requires_payment: form.requiresPayment,
        registration_url: form.requiresPayment
            ? form.registrationUrl.trim()
            : '',
        discipline: form.discipline,
        scoring_format: form.format,
        scoring: {
            ...props.competition?.scoring,
            topPool: form.topPool,
            zonePool: form.discipline === 'boulder' ? form.zonePool : 0,
            bestOf: usesBestOf.value && form.bestOfEnabled ? form.bestOf : null,
            flashBonus: usesFlashBonus.value ? form.flashBonus : 0,
            topropeFactor: form.topropePercent / 100,
        },
        live_ranking: form.liveRanking,
        freeze_minutes: form.liveRanking ? form.freezeMinutes : 0,
    }
}

const API_FORM_FIELDS: Record<string, string> = {
    name: 'name',
    description: 'description',
    location: 'location',
    starts_at: 'startsAt',
    ends_at: 'endsAt',
    registration_url: 'registrationUrl',
    freeze_minutes: 'freezeMinutes',
}

function showFieldErrors(error: unknown) {
    const errors = formFieldErrors(error, Object.keys(API_FORM_FIELDS), t).map(
        ({ name, message }) => ({ name: API_FORM_FIELDS[name]!, message }),
    )
    if (errors.length) formRef.value?.setErrors(errors)
    return errors.length > 0
}

async function createDraft() {
    draft = draft
        ? {
              ...draft,
              competition: await updateCompetition(
                  draft.competition.id,
                  buildBody(),
              ),
          }
        : {
              competition: await createCompetition(gymId.value, {
                  ...buildBody(),
                  status: 'draft',
              }),
              categories: 0,
          }
    const categories = defaultCategories(t)
    while (draft.categories < categories.length) {
        await createCompetitionCategory(
            draft.competition.id,
            categories[draft.categories]!,
        )
        draft.categories += 1
    }
    return draft.competition
}

async function save() {
    if (pending.value) return
    pending.value = true
    const valid = (await formRef.value?.validate({ silent: true })) !== false
    pending.value = false
    if (!valid) return
    await run(
        async () => {
            emit(
                'saved',
                props.competition
                    ? await updateCompetition(props.competition.id, buildBody())
                    : await createDraft(),
            )
            draft = null
            open.value = false
        },
        { success: t('competitions.saved'), handled: showFieldErrors },
    )
}
</script>
