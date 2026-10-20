<template>
    <template v-if="modelValue === undefined">
        <UButton
            v-if="callToAction"
            color="primary"
            size="xl"
            block
            icon="i-lucide-star-plus"
            data-testid="review-open-cta"
            @click="internalOpen = true"
        >
            {{ $t('ratings.createReview') }}
        </UButton>
        <UButton
            v-else
            color="neutral"
            variant="soft"
            data-testid="review-open"
            @click="internalOpen = true"
        >
            {{ $t('ratings.createReview') }}
        </UButton>
    </template>

    <LayoutDialogShell
        v-model="sheetOpen"
        max-width="600"
        closable
        sheet-on-mobile
        :title="
            isEditMode ? $t('comments.editReview') : $t('ratings.createReview')
        "
        data-testid="review-form-dialog"
        :submit-label="isEditMode ? $t('actions.save') : $t('actions.submit')"
        :submit-loading="saving"
        :submit-disabled="!isEditMode && (!isFormValid || !form.rating)"
        :captcha="!isEditMode"
        submit-test-id="review-form-submit"
        cancel-test-id="review-form-cancel"
        @submit="submit"
    >
        <div
            v-if="isEditMode && review"
            class="flex items-center gap-3 mb-4 p-3 rounded-lg review-form__context"
        >
            <ClimberAvatar :name="review.userName ?? ''" size="sm" />
            <div>
                <div class="text-sm font-medium">
                    {{ review.userName }}
                </div>
                <div class="text-xs text-muted">
                    {{ review.routeName }}
                </div>
            </div>
        </div>

        <UForm
            ref="formRef"
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            @submit.prevent
        >
            <div class="grid grid-cols-12 items-end gap-4 mb-4">
                <UFormField
                    :label="$t('ratings.stars')"
                    name="rating"
                    class="col-span-12 sm:col-span-6 review-form__rating"
                >
                    <UInputRating
                        :model-value="form.rating"
                        clearable
                        hoverable
                        size="lg"
                        :aria-label="$t('ratings.stars')"
                        :ui="{
                            root: 'gap-2',
                            indicator: 'data-[state=active]:text-amber-500',
                        }"
                        data-testid="review-form-rating"
                        @update:model-value="form.rating = $event || undefined"
                    >
                        <template #item="{ filled }">
                            <UIcon
                                name="i-lucide-star"
                                mode="svg"
                                class="size-6"
                                :class="
                                    filled ? '**:fill-current' : 'text-dimmed'
                                "
                            />
                        </template>
                    </UInputRating>
                </UFormField>

                <UFormField
                    :label="`${$t('ratings.difficulty')} (${$t(`gradeSystems.${gradeSystem}`)})`"
                    name="grade"
                    class="col-span-12 sm:col-span-6"
                >
                    <SegmentedControl
                        v-if="nearbyGrades"
                        v-model="selectedGrade"
                        :items="
                            nearbyGrades.map((grade) => ({
                                value: grade,
                                label: grade,
                            }))
                        "
                        size="md"
                        block
                        test-id="review-form-difficulty"
                    />
                    <USelectMenu
                        v-else
                        v-model="form.grade"
                        :items="gradeLabels(gradeSystem)"
                        clear
                        class="w-full"
                        data-testid="review-form-difficulty"
                        @clear="form.grade = null"
                    />
                </UFormField>
            </div>

            <UFormField
                :label="$t('ratings.comment')"
                :hint="isEditMode ? `${form.comment.length}/1000` : undefined"
                name="comment"
            >
                <UTextarea
                    v-model="form.comment"
                    :rows="6"
                    autoresize
                    class="w-full"
                    data-testid="review-form-comment"
                />
            </UFormField>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { createRating, updateRating, type RatingInput } from '~/api/ratings'
import {
    required,
    nonBlank,
    validateRules,
    type Rule,
} from '~/utils/validation'
import {
    DEFAULT_ROUTE_GRADE_SYSTEM,
    canonicalGrade,
    gradeIndex,
    gradeLabels,
    gradesAround,
    isGradeSystem,
} from '#shared/utils/grades'
import type { RatingRecord } from '~/types/models'
import { newRecordId } from '~/utils/realtimeCache'
import { formFieldErrors } from '~/utils/fieldErrors'
import { isAbortError } from '~/utils/errors'
import { useSessionEnded } from '~/composables/useSessionEnded'

type EditableReview = RatingRecord & { userName?: string; routeName?: string }

const props = withDefaults(
    defineProps<{
        modelValue?: boolean
        routeId?: string | null
        gradeSystem?: string | null
        routeGrade?: string | null
        review?: EditableReview | null
        callToAction?: boolean
    }>(),
    {
        modelValue: undefined,
        routeId: null,
        gradeSystem: null,
        routeGrade: null,
        review: null,
        callToAction: false,
    },
)
const gymId = useCurrentGymId()

const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    saved: [rating: RatingRecord | null]
}>()

const { t } = useI18n()
const { error: notifyError } = useNotification()
const { capHeaders } = useCapToken()
const { $realtimeCache } = useNuxtApp()

const isEditMode = computed(() => !!props.review)

const gradeSystem = computed(() => {
    const system = props.review?.grade_system || props.gradeSystem
    return isGradeSystem(system) ? system : DEFAULT_ROUTE_GRADE_SYSTEM
})

const routeGradeLabel = computed(() =>
    canonicalGrade(gradeSystem.value, props.routeGrade),
)

const nearbyGrades = computed(() =>
    routeGradeLabel.value
        ? gradesAround(gradeSystem.value, routeGradeLabel.value, 2)
        : null,
)

const selectedGrade = computed({
    get: () => form.grade ?? routeGradeLabel.value ?? '',
    set: (grade: string) => {
        form.grade = grade
    },
})

// ── Open state ─────────────────────────────────────────────────────────────

const internalOpen = ref(false)

const sheetOpen = computed({
    get() {
        return props.modelValue !== undefined
            ? props.modelValue
            : internalOpen.value
    },
    set(val) {
        if (props.modelValue !== undefined) {
            emit('update:modelValue', val)
        } else {
            internalOpen.value = val
        }
    },
})

// ── Form state ─────────────────────────────────────────────────────────────

const saving = ref(false)

const form = reactive({
    rating: undefined as number | undefined,
    grade: null as string | null,
    comment: '',
})

const rules = {
    required: required(t),
    requiredAndNotEmpty: nonBlank(t),
}

const formRules = computed((): Record<string, Rule[]> =>
    isEditMode.value
        ? {}
        : { grade: [rules.required], comment: [rules.requiredAndNotEmpty] },
)

const isFormValid = computed(
    () => validateRules(form, formRules.value).length === 0,
)

watch(
    () => props.review,
    (review) => {
        if (review) {
            form.rating = review.rating ?? undefined
            form.grade = review.grade || null
            form.comment = review.comment ?? ''
        }
    },
    { immediate: true },
)

watch(sheetOpen, (open) => {
    if (open) {
        if (props.review) {
            form.rating = props.review.rating ?? undefined
            form.grade = props.review.grade || null
            form.comment = props.review.comment ?? ''
        } else {
            resetForm()
        }
    } else if (!isEditMode.value) {
        resetForm()
    }
})

// ── Helpers ────────────────────────────────────────────────────────────────

function resetForm() {
    form.rating = undefined
    form.grade = routeGradeLabel.value
    form.comment = ''
}

function close() {
    sheetOpen.value = false
}

// ── Submit ─────────────────────────────────────────────────────────────────

function gradingFields() {
    return {
        grade: form.grade ?? '',
        grade_system: gradeSystem.value,
        grade_index: gradeIndex(gradeSystem.value, form.grade),
    }
}

const formRef = ref<{
    setErrors: (errors: { name: string; message: string }[]) => void
}>()
const noticeSessionEnded = useSessionEnded()

function showSaveError(error: unknown) {
    if (isAbortError(error) || noticeSessionEnded(error)) return
    const fieldErrors = formFieldErrors(
        error,
        ['rating', 'grade', 'comment'],
        t,
    )
    if (fieldErrors.length) formRef.value?.setErrors(fieldErrors)
    else notifyError(t('notifications.error.generic'))
}

async function submit() {
    if (saving.value) return
    if (isEditMode.value) return saveEdit()

    const input: RatingInput = {
        rating: form.rating,
        ...gradingFields(),
        comment: form.comment?.trim(),
    }
    const now = new Date().toISOString()
    const rating: RatingRecord = {
        id: newRecordId(),
        created: now,
        updated: now,
        gym: gymId.value,
        route_id: props.routeId!,
        rating: input.rating ?? 0,
        comment: input.comment ?? '',
        grade: input.grade ?? '',
        grade_system: input.grade_system ?? '',
        grade_index: input.grade_index ?? 0,
    }
    saving.value = true
    $realtimeCache.applyRating(rating)
    try {
        const created = await createRating(
            props.routeId!,
            input,
            await capHeaders('rating'),
        )
        $realtimeCache.revertRating(rating)
        $realtimeCache.applyRating(created)
        emit('saved', created)
        close()
    } catch (err) {
        $realtimeCache.revertRating(rating)
        showSaveError(err)
    } finally {
        saving.value = false
    }
}

async function saveEdit() {
    saving.value = true
    try {
        const updated = await updateRating(props.review!.id, {
            rating: form.rating,
            ...gradingFields(),
            comment: form.comment,
        })
        emit('saved', updated)
        close()
    } catch (err) {
        showSaveError(err)
    } finally {
        saving.value = false
    }
}
</script>

<style scoped>
.review-form__context {
    background: color-mix(in oklab, var(--ui-text-highlighted) 6%, transparent);
}

.review-form__rating {
    min-height: 56px;
}
</style>
