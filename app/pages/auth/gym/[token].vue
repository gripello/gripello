<template>
    <LayoutAuthLayout
        :loading="status !== 'success' && status !== 'error'"
        :eyebrow="$t('gymOnboarding.eyebrow')"
        :title="
            onboarding ? $t('gymOnboarding.title') : $t('account.linkInvalid')
        "
        :subtitle="
            onboarding
                ? $t('gymOnboarding.subtitle', { email: onboarding.email })
                : $t('gymOnboarding.invalid')
        "
        :heading-key="onboarding ? 'form' : 'invalid'"
        back-to="/"
    >
        <template #brand-headline>
            {{ $t('account.brandHeadline.login.l1') }}<br />
            {{ $t('account.brandHeadline.login.l2') }}<br />
            <span class="text-success">{{
                $t('account.brandHeadline.login.accent')
            }}</span>
        </template>

        <UButton
            v-if="status === 'success' && !onboarding"
            color="neutral"
            variant="soft"
            block
            size="xl"
            to="/"
            data-testid="gym-onboarding-invalid"
        >
            {{ $t('gymOnboarding.home') }}
        </UButton>

        <UForm
            v-else-if="onboarding"
            ref="gymForm"
            :state="form"
            :validate="validateGym"
            class="flex flex-col gap-4"
            data-testid="gym-onboarding-form"
            @submit="submit"
        >
            <UFormField :label="$t('platform.gyms.name')" name="name">
                <UInput
                    v-model="form.name"
                    size="xl"
                    class="w-full"
                    data-testid="gym-onboarding-name"
                    @update:model-value="syncSlug"
                />
            </UFormField>
            <UFormField :label="$t('platform.gyms.slug')" name="slug">
                <UInput
                    v-model="form.slug"
                    size="xl"
                    class="w-full"
                    :ui="{ base: 'font-mono' }"
                    data-testid="gym-onboarding-slug"
                    @update:model-value="slugEdited = true"
                />
            </UFormField>
            <UButton
                type="submit"
                color="success"
                block
                size="xl"
                class="font-semibold"
                :loading="saving"
                data-testid="gym-onboarding-submit"
            >
                {{ $t('gymOnboarding.submit') }}
            </UButton>
        </UForm>
    </LayoutAuthLayout>
</template>

<script setup lang="ts">
import type { Form } from '@nuxt/ui'
import { redeemGymOnboarding, showGymOnboarding } from '~/api/gyms'
import { isValidGymSlug, slugifyGymName } from '#shared/utils/gymSlug'
import { fieldErrorCode } from '~/utils/fieldErrors'
import { maxLength, required, validateRules } from '~/utils/validation'

definePageMeta({ layout: 'blank' })

const { t } = useI18n()
const route = useRoute()
const token = String(route.params.token ?? '')

useHead({ title: t('page.title.gymOnboarding') })

const { data: onboarding, status } = await useAsyncData(
    `gym-onboarding-${token}`,
    () => showGymOnboarding(token).catch(() => null),
    { server: false },
)

const form = reactive({ name: '', slug: '' })
const slugEdited = ref(false)
const gymForm = ref<Form<typeof form> | null>(null)
const saving = ref(false)
const { error: notifyError } = useNotification()

function syncSlug() {
    if (!slugEdited.value) form.slug = slugifyGymName(form.name)
}

function validateGym(state: typeof form) {
    return validateRules(state, {
        name: [required(t), maxLength(t, 100)],
        slug: [
            required(t),
            (slug) =>
                isValidGymSlug(String(slug)) || t('platform.gyms.invalidSlug'),
        ],
    })
}

async function submit() {
    saving.value = true
    try {
        const { invite } = await redeemGymOnboarding(token, {
            name: form.name.trim(),
            slug: form.slug,
        })
        await navigateTo(`/auth/invite/${invite}`)
    } catch (error) {
        const slugCode = fieldErrorCode(error, 'slug')
        if (slugCode) {
            gymForm.value?.setErrors([
                {
                    name: 'slug',
                    message: t(
                        slugCode === 'validation_slug_used'
                            ? 'gymOnboarding.slugTaken'
                            : 'platform.gyms.invalidSlug',
                    ),
                },
            ])
        } else if ((error as { status?: number })?.status === 404) {
            onboarding.value = null
        } else {
            notifyError(t('notifications.error.generic'))
        }
    } finally {
        saving.value = false
    }
}
</script>
