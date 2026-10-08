<template>
    <LayoutAuthLayout
        :org-unit-name="invite?.gym.name"
        :loading="step === 'loading' || accepting"
        :eyebrow="$t('invites.eyebrow')"
        :title="
            invite
                ? $t('invites.title', { gym: invite.gym.name })
                : step === 'invalid'
                  ? $t('account.linkInvalid')
                  : ''
        "
        :subtitle="subtitle"
        :heading-key="step"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <div v-if="step === 'invalid'" data-testid="invite-invalid">
            <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-left"
                block
                to="/auth/login"
                data-testid="invite-back"
            >
                {{ $t('actions.back_to_home') }}
            </UButton>
        </div>

        <UButton
            v-else-if="step === 'join'"
            color="success"
            block
            size="lg"
            class="font-semibold"
            :loading="accepting"
            data-testid="invite-join"
            @click="accept()"
        >
            {{ $t('invites.accept') }}
        </UButton>

        <UButton
            v-else-if="step === 'wrongAccount'"
            color="neutral"
            variant="soft"
            block
            size="lg"
            data-testid="invite-sign-out"
            @click="signOut"
        >
            {{ $t('invites.signOut') }}
        </UButton>

        <UButton
            v-else-if="step === 'signIn'"
            color="success"
            block
            size="lg"
            class="font-semibold"
            :to="loginPath"
            data-testid="invite-sign-in"
        >
            {{ $t('invites.signIn') }}
        </UButton>

        <form
            v-else-if="step === 'register'"
            class="flex flex-col gap-4"
            data-testid="invite-register"
            @submit.prevent="accept(registration)"
        >
            <div class="grid grid-cols-2 gap-3">
                <UFormField :label="$t('account.firstname')">
                    <UInput
                        v-model="registration.firstname"
                        autocomplete="given-name"
                        class="w-full"
                        data-testid="invite-firstname"
                    />
                </UFormField>
                <UFormField :label="$t('account.lastname')">
                    <UInput
                        v-model="registration.name"
                        autocomplete="family-name"
                        class="w-full"
                        data-testid="invite-lastname"
                    />
                </UFormField>
            </div>
            <UserPasswordChangeFields
                v-model:password="registration.password"
                v-model:password-confirm="registration.passwordConfirm"
                :require-old-password="false"
                @validity="passwordValid = $event"
            />
            <UButton
                type="submit"
                color="success"
                block
                size="lg"
                class="font-semibold"
                :loading="accepting"
                :disabled="accepting || !passwordValid"
                data-testid="invite-register-submit"
            >
                {{ $t('invites.accept') }}
            </UButton>
        </form>
    </LayoutAuthLayout>
</template>

<script setup lang="ts">
import type { AuthRecord } from 'pocketbase'
import type { InviteDetails } from '~/types/models'
import { inviteStep } from '~/utils/invites'

defineOptions({ name: 'InvitePage' })
definePageMeta({ layout: 'blank' })

const { t } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const token = String(route.params.token ?? '')

useHead({ title: t('page.title.invite') })

const {
    data: invite,
    status,
    refresh,
} = await useAsyncData(
    `invite-${token}`,
    () =>
        pb
            .send<InviteDetails>(`/api/invites/${encodeURIComponent(token)}`, {
                requestKey: null,
            })
            .catch(() => null),
    { server: false },
)

const currentEmail = ref(
    pb.authStore.isValid ? (pb.authStore.record?.email ?? '') : '',
)
const step = computed(() =>
    status.value === 'success'
        ? inviteStep(invite.value, currentEmail.value)
        : 'loading',
)
const subtitle = computed(() => {
    if (step.value === 'loading') return ''
    if (!invite.value) return t('invites.invalid')
    if (step.value === 'wrongAccount') {
        return t('invites.wrongAccount', {
            current: currentEmail.value,
            email: invite.value.email,
        })
    }
    return t('invites.subtitle', {
        email: invite.value.email,
        role: invite.value.role,
    })
})
const loginPath = `/auth/login?redirect=${encodeURIComponent(route.fullPath)}`

const registration = reactive({
    firstname: '',
    name: '',
    password: '',
    passwordConfirm: '',
})
watch(invite, (loaded) => {
    registration.firstname ||= loaded?.firstname ?? ''
    registration.name ||= loaded?.name ?? ''
})
const passwordValid = ref(false)
const accepting = ref(false)
const { error: notifyError } = useNotification()

function signOut() {
    pb.authStore.clear()
    currentEmail.value = ''
}

async function accept(body: Record<string, string> = {}) {
    accepting.value = true
    try {
        const result = await pb.send<{
            gym?: string
            token?: string
            record?: AuthRecord
            meta?: { gym?: string }
        }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
            method: 'POST',
            body,
            requestKey: null,
        })
        if (result.token && result.record) {
            pb.authStore.save(result.token, result.record)
        }
        const slug = result.gym ?? result.meta?.gym
        await navigateTo(slug ? `/${slug}` : '/', { external: true })
    } catch (error) {
        const code = (error as { status?: number })?.status
        if (code === 409 && currentEmail.value) signOut()
        if (code === 404 || code === 409) await refresh()
        else notifyError(t('notifications.error.generic'))
    } finally {
        accepting.value = false
    }
}
</script>
