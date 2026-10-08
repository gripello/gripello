<template>
    <LayoutPanel
        v-if="entry || registrationOpen"
        :title="$t('competitions.register.title')"
        data-testid="competition-registration"
    >
        <AuthGuestCta
            v-if="!userId"
            :redirect="gymPath(`/competitions/${competition.id}`)"
            test-id-prefix="competition"
        />

        <template v-else-if="entry">
            <div
                class="flex items-center gap-4"
                data-testid="competition-my-entry"
            >
                <div
                    class="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-primary"
                >
                    <span class="text-[10px] uppercase">{{
                        $t('competitions.bib')
                    }}</span>
                    <span
                        class="text-xl font-bold tabular-nums"
                        data-testid="competition-my-bib"
                        >{{ entry.bib }}</span
                    >
                </div>
                <div class="min-w-0 flex-1">
                    <p class="font-medium text-highlighted">
                        {{
                            entry.status === 'withdrawn'
                                ? $t('competitions.register.withdrawn')
                                : $t('competitions.register.youAreIn')
                        }}
                    </p>
                    <p class="truncate text-sm text-muted">
                        {{ entry.display_name }} · {{ myCategoryName }}
                    </p>
                </div>
                <UBadge
                    v-if="competition.requires_payment"
                    :color="entry.paid ? 'success' : 'neutral'"
                    variant="soft"
                    size="sm"
                    data-testid="competition-my-paid"
                >
                    {{
                        entry.paid
                            ? $t('competitions.paid')
                            : $t('competitions.notPaid')
                    }}
                </UBadge>
            </div>
            <div class="flex flex-wrap gap-2">
                <UButton
                    v-if="
                        competition.requires_payment &&
                        competition.registration_url &&
                        !entry.paid
                    "
                    :to="competition.registration_url"
                    target="_blank"
                    icon="i-lucide-external-link"
                    color="primary"
                    data-testid="competition-pay-link"
                >
                    {{ $t('competitions.register.payLink') }}
                </UButton>
                <UButton
                    v-if="entry.status === 'withdrawn' && registrationOpen"
                    icon="i-lucide-rotate-ccw"
                    color="primary"
                    variant="soft"
                    :loading="pending"
                    data-testid="competition-rejoin"
                    @click="setStatus('registered')"
                >
                    {{ $t('competitions.register.rejoin') }}
                </UButton>
                <UButton
                    v-else-if="
                        entry.status !== 'withdrawn' &&
                        entry.status !== 'disqualified'
                    "
                    icon="i-lucide-log-out"
                    color="neutral"
                    variant="ghost"
                    data-testid="competition-withdraw"
                    @click="withdrawOpen = true"
                >
                    {{ $t('competitions.register.withdraw') }}
                </UButton>
            </div>
        </template>

        <UForm
            v-else
            ref="formRef"
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            class="flex flex-col gap-4"
            @submit="register"
        >
            <UFormField
                :label="$t('competitions.register.displayName')"
                name="displayName"
            >
                <UInput
                    v-model="form.displayName"
                    class="w-full"
                    data-testid="competition-register-name"
                />
            </UFormField>
            <UFormField
                :label="$t('competitions.register.birthYear')"
                name="birthYear"
            >
                <UInputNumber
                    v-model="form.birthYear"
                    :min="currentYear - 120"
                    :max="currentYear"
                    :format-options="{ useGrouping: false }"
                    class="w-full"
                    data-testid="competition-register-birth-year"
                />
            </UFormField>
            <UFormField
                :label="$t('competitions.register.category')"
                name="category"
            >
                <USelect
                    v-model="form.category"
                    :items="categoryItems"
                    :placeholder="$t('competitions.register.pickCategory')"
                    :disabled="!categoryItems.length"
                    class="w-full"
                    data-testid="competition-register-category"
                />
            </UFormField>
            <USwitch
                v-model="form.hidden"
                :label="$t('competitions.register.hidden')"
                data-testid="competition-register-hidden"
            />
            <UFormField v-if="consentNeeded" name="guardianConsent">
                <UCheckbox
                    v-model="form.guardianConsent"
                    :label="$t('competitions.register.guardianConsent')"
                    data-testid="competition-register-consent"
                />
            </UFormField>
            <UButton
                type="submit"
                icon="i-lucide-user-plus"
                color="primary"
                class="self-start"
                :loading="pending"
                data-testid="competition-register-submit"
            >
                {{ $t('competitions.register.submit') }}
            </UButton>
        </UForm>

        <ConfirmDialog
            v-model="withdrawOpen"
            :title="$t('competitions.register.withdraw')"
            :message="$t('competitions.register.withdrawMessage')"
            :confirm-text="$t('competitions.register.withdraw')"
            :loading="pending"
            @confirm="withdraw"
        />
    </LayoutPanel>
</template>

<script setup lang="ts">
import {
    required,
    validateRules,
    maxLength,
    nonBlank,
} from '~/utils/validation'
import {
    acceptsRegistrations,
    birthYearRange,
    defaultDisplayName,
    categoriesFor,
    needsGuardianConsent,
} from '~/utils/competitions'
import type {
    CompetitionCategoryRecord,
    CompetitionEntryRecord,
    CompetitionEntryStatus,
    CompetitionRecord,
    UserRecord,
} from '~/types/models'

const gymPath = useGymPath()

const props = defineProps<{
    competition: CompetitionRecord
    entry: CompetitionEntryRecord | null
}>()

const emit = defineEmits<{ changed: [] }>()

const pb = usePocketbase()
const { t } = useI18n()
const { pending, run } = useAsyncAction()

const now = useNow()
const currentYear = now.value.getFullYear()
const userId = pb.authStore.record?.id ?? ''
const withdrawOpen = ref(false)

const form = reactive({
    displayName: defaultDisplayName(
        pb.authStore.record as Partial<UserRecord> | null,
    ),
    birthYear: undefined as number | undefined,
    category: undefined as string | undefined,
    hidden: false,
    guardianConsent: false,
})

const registrationOpen = computed(() =>
    acceptsRegistrations(props.competition, now.value),
)
const consentNeeded = computed(() =>
    needsGuardianConsent(form.birthYear, new Date()),
)

const formRules = computed(() => ({
    displayName: [nonBlank(t), maxLength(t, 60)],
    birthYear: [required(t)],
    category: [required(t)],
    guardianConsent: consentNeeded.value
        ? [(value: unknown) => value === true || t('validation.required')]
        : [],
}))

const { data: categories } = useAsyncData(
    () => `competition-public-categories:${props.competition.id}`,
    () =>
        pb
            .collection('competition_categories')
            .getFullList<CompetitionCategoryRecord>({
                filter: pb.filter('competition = {:id}', {
                    id: props.competition.id,
                }),
                sort: 'sort,name',
            }),
    { default: () => [] },
)

const categoryItems = computed(() =>
    categoriesFor(categories.value, form.birthYear).map((category) => {
        const range = birthYearRange(category)
        return {
            value: category.id,
            label: range ? `${category.name} (${range})` : category.name,
        }
    }),
)

const myCategoryName = computed(
    () =>
        categories.value.find(
            (category) => category.id === props.entry?.category,
        )?.name,
)

watch(categoryItems, (items) => {
    if (!items.some((item) => item.value === form.category)) {
        form.category = items.length === 1 ? items[0]!.value : undefined
    }
})

async function register() {
    await run(
        async () => {
            await pb.collection('competition_entries').create({
                competition: props.competition.id,
                user: userId,
                category: form.category,
                display_name: form.displayName.trim(),
                birth_year: form.birthYear,
                hidden: form.hidden,
                guardian_consent: consentNeeded.value && form.guardianConsent,
            })
            emit('changed')
        },
        { success: t('competitions.register.done') },
    )
}

async function setStatus(status: CompetitionEntryStatus) {
    const current = props.entry
    if (!current) return
    await run(async () => {
        await pb
            .collection('competition_entries')
            .update(current.id, { status })
        emit('changed')
    })
}

async function withdraw() {
    await setStatus('withdrawn')
    withdrawOpen.value = false
}
</script>
