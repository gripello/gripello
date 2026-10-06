<template>
    <LayoutDialogShell
        v-model="open"
        closable
        sheet-on-mobile
        :title="t('platform.users.suspendName', { name: displayName })"
        data-testid="platform-suspend-dialog"
    >
        <div class="flex flex-col gap-4">
            <fieldset>
                <legend class="mb-2 text-sm font-semibold text-highlighted">
                    {{ t('platform.users.suspendHowLong') }}
                </legend>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <UButton
                        v-for="option in DURATIONS"
                        :key="option"
                        block
                        :color="duration === option ? 'primary' : 'neutral'"
                        :variant="duration === option ? 'soft' : 'outline'"
                        :aria-pressed="duration === option"
                        :data-testid="`platform-suspend-${option}`"
                        @click="duration = option"
                    >
                        {{ t(`platform.users.durations.${option}`) }}
                    </UButton>
                </div>
            </fieldset>
            <UFormField
                v-if="duration === 'until'"
                :label="t('platform.users.suspendUntil')"
            >
                <UInput
                    v-model="until"
                    type="date"
                    :min="tomorrow"
                    class="w-full"
                    data-testid="platform-suspend-until"
                />
            </UFormField>
            <UFormField
                :label="t('platform.users.suspendReason')"
                :hint="`${reason.length}/2000`"
            >
                <UTextarea
                    v-model="reason"
                    :rows="3"
                    :maxlength="2000"
                    autoresize
                    class="w-full"
                    data-testid="platform-suspend-reason"
                />
            </UFormField>
            <UCheckbox
                v-model="hideContent"
                :label="t('platform.users.suspendHideContent')"
                data-testid="platform-suspend-hide-content"
            />
            <section class="rounded-xl bg-muted px-4 py-3">
                <h3 class="mb-1 text-sm font-semibold text-highlighted">
                    {{ t('moderation.decision.whatHappens') }}
                </h3>
                <ul class="list-disc ps-5 text-sm leading-relaxed">
                    <li>{{ t('platform.users.suspendEffects.signedOut') }}</li>
                    <li>{{ t('platform.users.suspendEffects.mail') }}</li>
                    <li>{{ t('platform.users.suspendEffects.kept') }}</li>
                    <li>{{ t('platform.users.suspendEffects.lift') }}</li>
                </ul>
            </section>
        </div>
        <template #actions>
            <UButton
                v-if="user && isSuspended(user)"
                color="neutral"
                variant="outline"
                :loading="pending"
                data-testid="platform-suspend-lift"
                @click="lift"
            >
                {{ t('platform.users.liftSuspension') }}
            </UButton>
            <UButton
                color="error"
                :disabled="!ready"
                :loading="pending"
                data-testid="platform-suspend-confirm"
                @click="suspend"
            >
                {{
                    duration === 'permanent'
                        ? t('platform.users.suspendPermanently')
                        : t('platform.users.suspend')
                }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { UserRecord } from '~/types/models'
import {
    isPermanentlySuspended,
    isSuspended,
    suspensionEnd,
    userDisplayName,
    type SuspensionDuration,
} from '~/utils/platformUsers'
import { localDateYYYYMMDD, parseDate } from '#shared/utils/formatting'

const DURATIONS: SuspensionDuration[] = ['week', 'month', 'until', 'permanent']

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ user: UserRecord | null }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const pb = usePocketbase()
const { pending, run } = useAsyncAction()

const tomorrow = localDateYYYYMMDD(new Date(Date.now() + 86_400_000))
const duration = ref<SuspensionDuration>('week')
const until = ref('')
const reason = ref('')
const hideContent = ref(false)
const displayName = computed(() =>
    props.user ? userDisplayName(props.user) || props.user.username : '',
)
const ready = computed(
    () =>
        !!reason.value.trim() && (duration.value !== 'until' || !!until.value),
)

watch(open, (isOpen) => {
    if (!isOpen) return
    const user = props.user
    const active = !!user && isSuspended(user)
    const permanent = active && isPermanentlySuspended(user)
    duration.value = 'week'
    if (active) duration.value = permanent ? 'permanent' : 'until'
    until.value =
        active && !permanent
            ? localDateYYYYMMDD(parseDate(user.suspended_until) ?? new Date())
            : ''
    reason.value = props.user?.suspension_reason ?? ''
    hideContent.value = false
})

async function send(method: 'POST' | 'DELETE', body?: object) {
    const done = await run(
        async () => {
            const id = props.user!.id
            await pb.send(`/api/platform/users/${id}/suspension`, {
                method,
                body,
            })
            if (method === 'POST' && hideContent.value)
                await pb.send(`/api/moderation/authors/${id}/hide`, {
                    method: 'POST',
                    body: { reason: reason.value.trim() },
                })
            return true
        },
        { success: t('moderation.saved') },
    )
    if (!done) return
    open.value = false
    emit('changed')
}

function suspend() {
    const end = suspensionEnd(duration.value, until.value)
    return send('POST', {
        ...(end ? { until: end } : { permanent: true }),
        reason: reason.value.trim(),
    })
}

function lift() {
    return send('DELETE')
}
</script>
