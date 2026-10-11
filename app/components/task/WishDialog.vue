<template>
    <LayoutDialogShell
        v-model="open"
        max-width="560"
        closable
        sheet-on-mobile
        :title="$t('tasks.wish.dialogTitle')"
        data-testid="task-wish-dialog"
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
                <div class="grid grid-cols-2 gap-2">
                    <UButton
                        v-for="type in ROUTE_TYPES"
                        :key="type"
                        :color="routeType === type ? 'primary' : 'neutral'"
                        :variant="routeType === type ? 'solid' : 'soft'"
                        :aria-pressed="routeType === type"
                        class="min-h-12 justify-center"
                        :data-testid="`task-wish-type-${type.toLowerCase()}`"
                        @click="routeType = type"
                    >
                        {{ $t(`routes.types.${type.toLowerCase()}`) }}
                    </UButton>
                </div>
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

        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="task-wish-cancel"
                @click="open = false"
                >{{ $t('actions.cancel') }}</UButton
            >
            <div class="flex-1" />
            <UButton
                :disabled="!location || !routeType || pending"
                color="primary"
                data-testid="task-wish-submit"
                @click="submit"
            >
                <CaptchaLoader v-if="pending" />
                <template v-else>{{ $t('tasks.wish.submit') }}</template>
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { ROUTE_TYPES } from '~/utils/routes'
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
const { capHeaders } = useCapToken()
const { pending, run } = useAsyncAction()
const { data: locations } = useLocations()
const { gradeSystemFor } = useGradeSystems()

const location = ref('')
const routeType = ref<(typeof ROUTE_TYPES)[number] | null>(null)
const grade = ref<string | undefined>(undefined)
const description = ref('')

const locationItems = computed(() =>
    locations.value.map((record) => ({
        label: record.name,
        value: record.id,
    })),
)
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
