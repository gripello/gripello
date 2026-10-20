<template>
    <LayoutDialogShell
        v-model="open"
        max-width="560"
        closable
        sheet-on-mobile
        :title="$t('tasks.defect.dialogTitle')"
        data-testid="task-defect-dialog"
        :submit-label="$t('tasks.defect.submit')"
        :submit-loading="pending"
        :submit-disabled="!selectedCategory"
        captcha
        submit-test-id="task-defect-submit"
        cancel-test-id="task-defect-cancel"
        @submit="submit"
    >
        <p class="text-sm text-muted mb-4">
            {{ $t('tasks.defect.dialogIntro') }}
        </p>

        <UAlert
            v-if="openDefects.length"
            color="warning"
            variant="soft"
            icon="i-lucide-info"
            class="mb-4"
            :title="$t('tasks.defect.alreadyReported')"
            :description="openDefectLabels"
            data-testid="task-defect-known"
        />

        <fieldset class="mb-4">
            <legend class="text-sm font-medium mb-2">
                {{ $t('tasks.defect.whatsWrong') }}
            </legend>
            <OptionGrid
                v-model="selectedCategory"
                :items="categoryItems"
                cols="grid-cols-2 sm:grid-cols-3"
                :label="$t('tasks.defect.whatsWrong')"
                test-id-prefix="task-defect-category"
            />
        </fieldset>

        <UFormField
            :label="$t('tasks.defect.details')"
            :hint="`${description.length}/2000`"
            class="mb-4"
        >
            <UTextarea
                v-model="description"
                :rows="2"
                :maxlength="2000"
                autoresize
                :placeholder="$t('tasks.defect.detailsPlaceholder')"
                class="w-full"
                data-testid="task-defect-description"
            />
        </UFormField>

        <UFormField :label="$t('tasks.photo')" :help="$t('tasks.photoHint')">
            <UFileUpload
                v-model="photo"
                accept="image/jpeg,image/png,image/webp"
                :label="$t('tasks.photoAdd')"
                icon="i-lucide-camera"
                class="w-full min-h-28"
                data-testid="task-defect-photo"
            />
        </UFormField>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { DEFECT_CATEGORIES } from '#shared/utils/tasks'
import { DEFECT_CATEGORY_ICONS } from '~/utils/tasks'
import { createTask } from '~/api/tasks'
import type { DefectCategory, OpenRouteDefectRecord } from '~/types/models'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const props = defineProps<{
    routeId: string
    openDefects: OpenRouteDefectRecord[]
}>()

const emit = defineEmits<{ submitted: [] }>()

const open = defineModel<boolean>({ default: false })

const gymId = useCurrentGymId()
const { t } = useI18n()

const categoryItems = computed(() =>
    DEFECT_CATEGORIES.map((category) => ({
        value: category,
        label: t(`tasks.categories.${category}`),
        icon: DEFECT_CATEGORY_ICONS[category],
    })),
)
const { capHeaders } = useCapToken()
const { warning } = useNotification()
const { pending, run } = useAsyncAction()

const selectedCategory = ref<DefectCategory | null>(null)
const description = ref('')
const photo = ref<File | null>(null)

const openDefectLabels = computed(() =>
    [
        ...new Set(
            props.openDefects.map((defect) =>
                t(`tasks.categories.${defect.category}`),
            ),
        ),
    ].join(', '),
)

watch(open, (isOpen) => {
    if (!isOpen) return
    selectedCategory.value = null
    description.value = ''
    photo.value = null
})

async function submit() {
    if (photo.value && photo.value.size > MAX_PHOTO_BYTES) {
        warning(t('tasks.photoTooLarge'))
        return
    }
    await run(
        async () => {
            await createTask(
                gymId.value,
                {
                    kind: 'defect',
                    route: props.routeId,
                    category: selectedCategory.value ?? '',
                    description: description.value.trim(),
                },
                photo.value,
                { headers: await capHeaders('task') },
            )
            emit('submitted')
            open.value = false
        },
        { success: t('tasks.defect.submitted') },
    )
}
</script>
