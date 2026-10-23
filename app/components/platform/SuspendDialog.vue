<template>
    <LayoutDialogShell
        v-model="open"
        closable
        sheet-on-mobile
        :title="t('platform.users.suspendName', { name: userName })"
        data-testid="platform-suspend-dialog"
        :submit-label="
            duration === 'permanent'
                ? t('platform.users.suspendPermanently')
                : t('platform.users.suspend')
        "
        submit-color="error"
        :submit-loading="pending"
        :submit-disabled="!ready"
        submit-test-id="platform-suspend-confirm"
        @submit="suspend"
    >
        <div class="flex flex-col gap-4">
            <fieldset>
                <legend class="mb-2 text-sm font-semibold text-highlighted">
                    {{ t('platform.users.suspendHowLong') }}
                </legend>
                <OptionGrid
                    v-model="duration"
                    :items="durationItems"
                    cols="grid-cols-2 sm:grid-cols-4"
                    :label="t('platform.users.suspendHowLong')"
                    test-id-prefix="platform-suspend"
                />
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
            <UCheckbox
                v-if="choices.email"
                v-model="blockEmail"
                :label="
                    t('platform.users.blockEmail', {
                        email: suggestions?.email,
                    })
                "
                data-testid="platform-suspend-block-email"
            />
            <UCheckbox
                v-if="choices.domain"
                v-model="blockDomain"
                :label="
                    t('platform.users.blockDomain', {
                        domain: suggestions?.domain,
                    })
                "
                :description="
                    suggestions?.domain_accounts
                        ? t(
                              'platform.users.blockDomainShared',
                              {
                                  accounts: suggestions.domain_accounts,
                                  suspended: suggestions.domain_suspended,
                              },
                              suggestions.domain_accounts,
                          )
                        : undefined
                "
                data-testid="platform-suspend-block-domain"
            />
            <UserReauthField
                v-model="adminPassword"
                data-testid="platform-suspend-admin-password"
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
        <template #footer-start>
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
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { translatedItems } from '~/utils/translatedItems'
import { displayName } from '~/utils/avatar'
import { hideAuthorContent } from '~/api/moderation'
import {
    addBlockedEmails,
    getBlockSuggestions,
    liftSuspension,
    suspendUser,
    type BlockSuggestions,
    type Suspension,
} from '~/api/platform'
import type { UserRecord } from '~/types/models'
import {
    blockChoices,
    isPermanentlySuspended,
    isSuspended,
    suspensionEnd,
    type SuspensionDuration,
} from '~/utils/platformUsers'
import { localDateYYYYMMDD, parseDate } from '#shared/utils/formatting'

const DURATIONS: SuspensionDuration[] = ['week', 'month', 'until', 'permanent']

const open = defineModel<boolean>({ default: false })
const props = defineProps<{ user: UserRecord | null }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { pending, run } = useAsyncAction()
const { error: notifyError } = useNotification()

const tomorrow = localDateYYYYMMDD(new Date(Date.now() + 86_400_000))
const duration = ref<SuspensionDuration>('week')
const durationItems = computed(() =>
    translatedItems(DURATIONS, 'platform.users.durations', t),
)
const until = ref('')
const reason = ref('')
const hideContent = ref(false)
const {
    password: adminPassword,
    confirm: reauthenticate,
    errorText: reauthError,
} = useReauth(open)
const suggestions = ref<BlockSuggestions | null>(null)
const choices = computed(() => blockChoices(suggestions.value))
const blockEmail = ref(false)
const blockDomain = ref(false)
const suspendedUser = ref<string | null>(null)
const userName = computed(() => displayName(props.user))
const ready = computed(
    () =>
        !!reason.value.trim() &&
        (duration.value !== 'until' || !!until.value) &&
        !!adminPassword.value,
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
    blockEmail.value = blockDomain.value = false
    suspendedUser.value = null
    suggestions.value = null
    if (user)
        getBlockSuggestions(user.id)
            .then((found) => {
                if (open.value && props.user?.id === user.id)
                    suggestions.value = found
            })
            .catch(() => (suggestions.value = null))
})

function blockedPatterns() {
    const patterns: string[] = []
    if (choices.value.email && blockEmail.value)
        patterns.push(suggestions.value!.email)
    if (choices.value.domain && blockDomain.value)
        patterns.push(suggestions.value!.domain)
    return patterns
}

async function send(suspension?: Suspension) {
    if (pending.value) return
    const id = props.user!.id
    const done = await run(
        async () => {
            if (!suspension) await liftSuspension(id)
            else if (suspendedUser.value !== id) {
                await reauthenticate()
                await suspendUser(id, suspension)
                suspendedUser.value = id
            }
            if (suspension && hideContent.value)
                await hideAuthorContent(id, reason.value.trim())
            const patterns = suspension ? blockedPatterns() : []
            if (patterns.length)
                await addBlockedEmails(patterns).catch((error) => {
                    console.error(error)
                    notifyError(t('platform.users.blockFailed'))
                })
            return true
        },
        {
            success: t('moderation.saved'),
            error: (error) =>
                suspendedUser.value === id
                    ? t('platform.users.hideContentFailed')
                    : reauthError(t('notifications.error.generic'))(error),
        },
    )
    if (!done) return
    open.value = false
    emit('changed')
}

function suspend() {
    const end = suspensionEnd(duration.value, until.value)
    const why = reason.value.trim()
    return send(
        end ? { until: end, reason: why } : { permanent: true, reason: why },
    )
}

function lift() {
    return send()
}
</script>
