<template>
    <LayoutDialogShell
        v-model="open"
        max-width="560"
        closable
        sheet-on-mobile
        :title="$t('tasks.wish.dialogTitle')"
        data-testid="task-wish-dialog"
        :submit-label="$t('tasks.wish.submit')"
        :submit-loading="pending"
        :submit-disabled="!location || !routeType"
        captcha
        submit-test-id="task-wish-submit"
        cancel-test-id="task-wish-cancel"
        @submit="submit"
    >
        <div class="flex flex-col gap-4">
            <UFormField :label="$t('climbing.location')" required>
                <USelect
                    v-model="location"
                    :items="locationItems"
                    class="w-full"
                    data-testid="task-wish-location"
                />
            </UFormField>

            <fieldset>
                <legend class="text-sm font-medium mb-2">
                    {{ $t('climbing.type') }}
                </legend>
                <OptionGrid
                    v-model="routeType"
                    :items="typeItems"
                    :label="$t('climbing.type')"
                    test-id-prefix="task-wish-type"
                />
            </fieldset>

            <UFormField :label="$t('climbing.difficulty')">
                <USelect
                    v-model="grade"
                    :items="gradeItems"
                    :disabled="!routeType"
                    class="w-full"
                    data-testid="task-wish-grade"
                />
            </UFormField>

            <UFormField
                :label="$t('tasks.wish.details')"
                :hint="`${description.length}/2000`"
            >
                <UTextarea
                    v-model="description"
                    :rows="2"
                    :maxlength="2000"
                    autoresize
                    :placeholder="$t('tasks.wish.detailsPlaceholder')"
                    class="w-full"
                    data-testid="task-wish-description"
                />
            </UFormField>
        </div>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { ROUTE_TYPES } from '#shared/utils/routeTypes'
import { createTask } from '~/api/tasks'
import { gradeLabels } from '#shared/utils/grades'

const props = defineProps<{
    locationId?: string
    wallId?: string
    routeType?: string
    grade?: string
}>()

const open = defineModel<boolean>({ default: false })

const gymId = useCurrentGymId()
const { t } = useI18n()

const typeItems = computed(() =>
    ROUTE_TYPES.map((type) => ({
        value: type,
        id: type.toLowerCase(),
        label: t(`routes.types.${type.toLowerCase()}`),
    })),
)
const { capHeaders } = useCapToken()
const { pending, run } = useAsyncAction()
const { data: locations, items: locationItems } = useLocations()
const { gradeSystemFor } = useGradeSystems()

const location = ref('')
const routeType = ref<(typeof ROUTE_TYPES)[number] | null>(null)
const grade = ref<string | undefined>(undefined)
const description = ref('')

const gradeItems = computed(() =>
    routeType.value ? gradeLabels(gradeSystemFor(routeType.value)) : [],
)

watch(gradeItems, (items) => {
    if (grade.value && !items.includes(grade.value)) grade.value = undefined
})

watch(open, (isOpen) => {
    if (!isOpen) return
    location.value =
        props.locationId ||
        (locations.value.length === 1 ? locations.value[0]!.id : '')
    routeType.value =
        ROUTE_TYPES.find((type) => type === props.routeType) ?? null
    grade.value = props.grade || undefined
    description.value = ''
})

async function submit() {
    await run(
        async () => {
            await createTask(
                gymId.value,
                {
                    kind: 'wish',
                    location: location.value,
                    wall:
                        props.wallId && location.value === props.locationId
                            ? props.wallId
                            : '',
                    route_type: routeType.value,
                    grade: grade.value ?? '',
                    description: description.value.trim(),
                },
                null,
                { headers: await capHeaders('task') },
            )
            open.value = false
        },
        { success: t('tasks.wish.submitted') },
    )
}
</script>
