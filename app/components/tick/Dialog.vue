<template>
    <LayoutDialogShell
        v-model="open"
        max-width="480"
        closable
        sheet-on-mobile
        :title="tick ? $t('ticks.edit') : $t('ticks.logAscent')"
        data-testid="tick-dialog"
        :submit-label="$t('actions.save')"
        :submit-loading="saving"
        submit-test-id="tick-submit"
        @submit="submit"
    >
        <UForm
            ref="formRef"
            :state="form"
            :validate="
                (state) =>
                    validateRules(state, {
                        attempts: [attemptsRule],
                        day: [required(t)],
                    })
            "
            @submit="submit"
        >
            <OptionGrid
                v-model="form.type"
                :items="typeItems"
                cols="grid-cols-3"
                :label="$t('ticks.type')"
                test-id-prefix="tick-type"
                class="mb-5"
            />

            <div class="grid grid-cols-12 gap-3 mb-4">
                <UFormField
                    name="attempts"
                    :label="$t('ticks.attempts')"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInputNumber
                        v-model="form.attempts"
                        :min="1"
                        :max="999"
                        :disabled="form.type === 'flash'"
                        class="w-full"
                        data-testid="tick-attempts"
                    />
                </UFormField>
                <UFormField
                    name="day"
                    :label="$t('ticks.date')"
                    class="col-span-12 sm:col-span-6"
                >
                    <UInput
                        v-model="form.day"
                        type="date"
                        :max="today"
                        class="w-full"
                        data-testid="tick-date"
                    />
                </UFormField>
            </div>

            <UFormField
                name="note"
                :label="$t('ticks.note')"
                :help="$t('ticks.noteHint')"
                :hint="`${form.note.length}/500`"
            >
                <UTextarea
                    v-model="form.note"
                    :maxlength="500"
                    :rows="2"
                    autoresize
                    class="w-full"
                    data-testid="tick-note"
                />
            </UFormField>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import type { RouteRecord, TickRecord } from '~/types/models'
import { required, validateRules } from '~/utils/validation'
import { TICK_TYPES, tickDay, type TickType } from '#shared/utils/ticks'
import { localDay } from '#shared/utils/ticks'
import { TICK_TYPE_ICONS } from '~/utils/ticks'
import { formFieldErrors } from '~/utils/fieldErrors'
import { useSessionEnded } from '~/composables/useSessionEnded'
import { requestErrorKey } from '~/utils/errors'
import { cacheKeys } from '~/utils/realtimeCache'

const open = defineModel<boolean>({ default: false })

const props = withDefaults(
    defineProps<{
        routeId?: string | null
        tick?: TickRecord | null
    }>(),
    { routeId: null, tick: null },
)

const emit = defineEmits<{ saved: [tick: TickRecord] }>()

const authStore = useAuthStore()
const { t } = useI18n()

const typeItems = computed(() =>
    TICK_TYPES.map((type) => ({
        value: type,
        label: t(`ticks.types.${type}`),
        icon: TICK_TYPE_ICONS[type],
    })),
)
const { notify, error: notifyError } = useNotification()
const { createTick, updateTick } = useTickOutbox()
const noticeSessionEnded = useSessionEnded()
const nuxtApp = useNuxtApp()
const { gym } = useGym()

function shownRoute(id: string): RouteRecord | undefined {
    const cached = (key: string) => nuxtApp._asyncData?.[key]?.data.value
    const single = cached(cacheKeys.route(id)) as RouteRecord | null | undefined
    if (single?.id === id) return single
    return (cached(cacheKeys.mapRoutes) as RouteRecord[] | undefined)?.find(
        (route) => route.id === id,
    )
}

// The server copies the route into a tick; a queued tick needs it to show in the logbook before it syncs.
function routeSnapshot(id: string): Partial<TickRecord> {
    const route = shownRoute(id)
    if (!route) return {}
    const routeGym = gym.value?.id === route.gym ? gym.value : null
    return {
        route_name: route.name,
        grade: route.grade,
        grade_system: route.grade_system,
        grade_index: route.grade_index,
        ...(routeGym && {
            expand: {
                route: {
                    id: route.id,
                    gym: route.gym,
                    name: route.name,
                    type: route.type,
                    color: route.color,
                    grade: route.grade,
                    grade_system: route.grade_system,
                    grade_index: route.grade_index,
                    archived: route.archived,
                    permanent: route.permanent,
                    location: route.location,
                    wall: route.wall,
                    expand: {
                        gym: {
                            id: routeGym.id,
                            slug: routeGym.slug,
                            name: routeGym.name,
                        },
                    },
                },
            },
        }),
    }
}

const saving = ref(false)
const today = ref(localToday())

const form = reactive({
    type: 'top' as TickType,
    attempts: 1,
    day: today.value,
    note: '',
})

const formRef = useTemplateRef<Form<typeof form>>('formRef')

const attemptsRule = (value: unknown) =>
    (Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 999) ||
    t('ticks.attemptsInvalid')

function localToday() {
    return localDay(new Date())
}

watch(open, (isOpen) => {
    if (!isOpen) return
    today.value = localToday()
    form.type = props.tick?.type ?? 'top'
    form.attempts = props.tick?.attempts ?? 1
    form.day = props.tick ? tickDay(props.tick.date) : today.value
    form.note = props.tick?.note ?? ''
})

watch(
    () => form.type,
    (type) => {
        if (type === 'flash') form.attempts = 1
    },
)

async function submit() {
    if (saving.value || !formRef.value) return
    saving.value = true
    const valid = (await formRef.value.validate({ silent: true })) !== false
    if (!valid) {
        saving.value = false
        return
    }
    const fields = {
        type: form.type,
        attempts: form.attempts,
        date: form.day,
        note: form.note.trim(),
    }
    try {
        const { tick: saved, queued } = props.tick
            ? await updateTick(props.tick, fields)
            : await createTick({
                  ...routeSnapshot(props.routeId ?? ''),
                  ...fields,
                  user: authStore.record?.id ?? '',
                  route: props.routeId ?? '',
              })
        notify(t(queued ? 'ticks.savedOffline' : 'ticks.saved'))
        emit('saved', saved)
        open.value = false
    } catch (err) {
        if (noticeSessionEnded(err)) return
        const fieldErrors = formFieldErrors(
            err,
            ['type', 'attempts', 'note', 'date'],
            t,
        ).map((error) =>
            error.name === 'date' ? { ...error, name: 'day' } : error,
        )
        if (fieldErrors.length) formRef.value?.setErrors(fieldErrors)
        else notifyError(t(requestErrorKey(err, 'ticks.saveError')))
    } finally {
        saving.value = false
    }
}
</script>
