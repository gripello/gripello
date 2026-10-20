<template>
    <LayoutPanel
        :title="t('platform.onboardings.title')"
        data-testid="platform-gym-onboardings"
    >
        <template #actions>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-send"
                data-testid="platform-gym-onboarding-create"
                @click="openDialog"
            >
                {{ t('platform.onboardings.send') }}
            </UButton>
        </template>

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="t('errors.loadFailed')"
        />
        <LayoutEmptyState
            v-else-if="!onboardings?.length"
            icon="i-lucide-mail"
            :title="t('platform.onboardings.empty')"
        />
        <LayoutListGroup v-else>
            <LayoutListRow
                v-for="onboarding in onboardings"
                :key="onboarding.id"
                :data-testid="`platform-gym-onboarding-${onboarding.email}`"
            >
                <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">
                        {{ onboarding.email }}
                    </div>
                    <div class="truncate text-sm text-muted">
                        {{
                            t('invites.expires', {
                                date: formatDate(onboarding.expires_at, {
                                    locale,
                                }),
                            })
                        }}
                    </div>
                </div>
                <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-refresh-cw"
                    class="icon-btn"
                    :aria-label="t('invites.resend')"
                    :loading="sending && busy === `send:${onboarding.email}`"
                    :disabled="sending"
                    :data-testid="`platform-gym-onboarding-resend-${onboarding.email}`"
                    @click="send(onboarding.email)"
                />
                <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-x"
                    class="icon-btn"
                    :aria-label="t('platform.onboardings.revoke')"
                    :data-testid="`platform-gym-onboarding-revoke-${onboarding.email}`"
                    :loading="sending && busy === `revoke:${onboarding.email}`"
                    :disabled="sending"
                    @click="revoke(onboarding)"
                />
            </LayoutListRow>
        </LayoutListGroup>

        <LayoutDialogShell
            v-model="dialogOpen"
            :title="t('platform.onboardings.send')"
            sheet-on-mobile
            closable
            data-testid="platform-gym-onboarding-dialog"
        >
            <UForm
                ref="emailForm"
                :state="form"
                :validate="
                    (state) =>
                        validateRules(state, {
                            email: [required(t), validEmail(t)],
                        })
                "
                @submit="send(form.email)"
            >
                <UFormField :label="t('account.email')" name="email">
                    <UInput
                        v-model="form.email"
                        type="email"
                        autocomplete="off"
                        class="w-full"
                        data-testid="platform-gym-onboarding-email"
                    />
                </UFormField>
            </UForm>
            <template #actions>
                <UButton
                    color="neutral"
                    variant="ghost"
                    @click="dialogOpen = false"
                >
                    {{ t('actions.cancel') }}
                </UButton>
                <div class="flex-1" />
                <UButton
                    color="primary"
                    :loading="sending"
                    data-testid="platform-gym-onboarding-submit"
                    @click="emailForm?.submit()"
                >
                    {{ t('platform.onboardings.send') }}
                </UButton>
            </template>
        </LayoutDialogShell>
    </LayoutPanel>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import { formatDate } from '#shared/utils/formatting'
import {
    createGymOnboarding,
    deleteGymOnboarding,
    listGymOnboardings,
    type GymOnboarding,
} from '~/api/gyms'
import { required, validEmail, validateRules } from '~/utils/validation'

const { t, locale } = useI18n()

const {
    data: onboardings,
    error,
    refresh,
} = useAsyncData('platform-gym-onboardings', listGymOnboardings)

const dialogOpen = ref(false)
const form = reactive({ email: '' })
const emailForm = ref<Form<typeof form> | null>(null)
const { pending: sending, run } = useAsyncAction()
const busy = ref('')

function openDialog() {
    form.email = ''
    dialogOpen.value = true
}

async function send(email: string) {
    busy.value = `send:${email}`
    await run(
        async () => {
            await createGymOnboarding(email.trim())
            dialogOpen.value = false
            await refresh()
        },
        { success: t('platform.onboardings.sent', { email: email.trim() }) },
    )
}

async function revoke(onboarding: GymOnboarding) {
    busy.value = `revoke:${onboarding.email}`
    await run(async () => {
        await deleteGymOnboarding(onboarding.id)
        await refresh()
    })
}
</script>
