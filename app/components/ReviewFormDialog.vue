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
    >
        <div
            v-if="isEditMode && review"
            class="flex items-center gap-3 mb-4 p-3 rounded-lg review-form__context"
        >
            <span
                class="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                :style="{ backgroundColor: avatarColor(review.userName) }"
            >
                {{ nameInitials(review.userName) }}
            </span>
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
            :state="form"
            :validate="(state) => validateRules(state, formRules)"
            @submit.prevent
        >
            <div class="grid grid-cols-12 items-end gap-4 mb-4">
                <div
                    class="col-span-12 sm:col-span-6 flex flex-col gap-1 review-form__rating"
                >
                    <span
                        id="review-form-rating-label"
                        class="text-sm font-medium text-default"
                        >{{ $t('ratings.stars') }}</span
                    >
                    <div
                        role="radiogroup"
                        aria-labelledby="review-form-rating-label"
                        class="flex items-center"
                        data-testid="review-form-rating"
                        @mouseleave="hoverRating = null"
                    >
                        <button
                            v-for="star in 5"
                            :key="star"
                            type="button"
                            role="radio"
                            :aria-checked="form.rating === star"
                            :aria-label="`${$t('ratings.stars')}: ${star}/5`"
                            class="rounded p-1 focus-visible:outline-2 focus-visible:outline-primary"
                            @mouseenter="hoverRating = star"
                            @click="toggleRating(star)"
                        >
                            <UIcon
                                name="i-lucide-star"
                                mode="svg"
                                class="size-6"
                                :class="
                                    star <= (hoverRating ?? form.rating ?? 0)
                                        ? 'text-amber-500 **:fill-current'
                                        : 'text-dimmed'
                                "
                            />
                        </button>
                    </div>
                </div>

                <UFormField
                    :label="`${$t('ratings.difficulty')} (${$t(`gradeSystems.${gradeSystem}`)})`"
                    name="grade"
                    class="col-span-12 sm:col-span-6"
                >
                    <USelectMenu
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

        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="review-form-cancel"
                @click="close"
                >{{ $t('actions.cancel') }}</UButton
            >
            <div class="flex-1" />
            <UButton
                :disabled="
                    saving || (!isEditMode && (!isFormValid || !form.rating))
                "
                color="primary"
                data-testid="review-form-submit"
                @click="submit"
            >
                <CaptchaLoader v-if="saving" />
                <template v-else>{{
                    isEditMode ? $t('actions.save') : $t('actions.submit')
                }}</template>
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import {
    required,
    nonBlank,
    validateRules,
    type Rule,
} from '~/utils/validation'
import {
    DEFAULT_ROUTE_GRADE_SYSTEM,
    gradeIndex,
    gradeLabels,
    isGradeSystem,
} from '#shared/utils/grades'
import type { RatingRecord } from '~/types/models'
import { avatarColor, nameInitials } from '~/utils/avatar'
import { newRecordId } from '~/utils/realtimeCache'

type EditableReview = RatingRecord & { userName?: string; routeName?: string }

const props = withDefaults(
    defineProps<{
        modelValue?: boolean
        routeId?: string | null
        gradeSystem?: string | null
        review?: EditableReview | null
        callToAction?: boolean
    }>(),
    {
        modelValue: undefined,
        routeId: null,
        gradeSystem: null,
        review: null,
        callToAction: false,
    },
)

const emit = defineEmits<{
    'update:modelValue': [open: boolean]
    saved: [rating: RatingRecord | null]
}>()

const pb = usePocketbase()
const { t } = useI18n()
const { error: notifyError } = useNotification()
const { capHeaders } = useCapToken()
const { $realtimeCache } = useNuxtApp()

const isEditMode = computed(() => !!props.review)

const gradeSystem = computed(() => {
    const system = props.review?.grade_system || props.gradeSystem
    return isGradeSystem(system) ? system : DEFAULT_ROUTE_GRADE_SYSTEM
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

const hoverRating = ref<number | null>(null)
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

function toggleRating(star: number) {
    form.rating = form.rating === star ? undefined : star
}

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
    form.grade = null
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

async function submit() {
    if (isEditMode.value) return saveEdit()

    const rating: RatingRecord = {
        id: newRecordId(),
        route_id: props.routeId,
        rating: form.rating,
        ...gradingFields(),
        comment: form.comment?.trim(),
    }
    $realtimeCache.applyRating({ ...rating, created: new Date().toISOString() })
    emit('saved', null)
    close()
    try {
        await pb.collection('ratings').create(rating, {
            headers: await capHeaders('rating'),
        })
    } catch (err) {
        $realtimeCache.revertRating(rating)
        console.error('Failed to save review:', err)
        notifyError(t('notifications.error.generic'))
    }
}

async function saveEdit() {
    saving.value = true
    try {
        const updated = await pb
            .collection('ratings')
            .update<RatingRecord>(props.review!.id, {
                rating: form.rating,
                ...gradingFields(),
                comment: form.comment,
            })
        emit('saved', updated)
        close()
    } catch (err) {
        console.error('Failed to save review:', err)
        notifyError(t('notifications.error.generic'))
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
