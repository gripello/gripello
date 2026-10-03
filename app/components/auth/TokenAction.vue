<template>
    <LayoutAuthLayout
        :loading="loading"
        :eyebrow="heading.eyebrow"
        :title="heading.title"
        :subtitle="heading.subtitle"
        :heading-key="step"
    >
        <template #brand-headline>
            {{ $t(`account.brandHeadline.${brandHeadline}.l1`) }}<br />
            {{ $t(`account.brandHeadline.${brandHeadline}.l2`) }}<br />
            <span class="text-success">{{
                $t(`account.brandHeadline.${brandHeadline}.accent`)
            }}</span>
        </template>

        <div class="relative">
            <Transition name="form-swap" mode="out-in">
                <div
                    v-if="step === 'form' && auto"
                    key="pending"
                    class="text-center py-6"
                    :data-testid="`${testidPrefix}-pending`"
                >
                    <UIcon
                        name="i-lucide-loader-circle"
                        class="mb-6 size-12 animate-spin text-success"
                    />
                </div>

                <div v-else-if="step === 'form'" key="form">
                    <slot :submit="submit" :loading="loading" />

                    <UButton
                        color="neutral"
                        variant="ghost"
                        block
                        class="text-muted"
                        icon="i-lucide-arrow-left"
                        :disabled="loading"
                        @click="navigateTo('/auth/login')"
                    >
                        {{ $t('actions.back_to_home') }}
                    </UButton>
                </div>

                <div
                    v-else-if="step === 'done'"
                    key="done"
                    class="text-center py-6"
                    :data-testid="`${testidPrefix}-done`"
                >
                    <div class="success-ring">
                        <UIcon
                            name="i-lucide-circle-check"
                            class="size-[40px] text-success"
                        />
                    </div>

                    <UButton
                        color="success"
                        block
                        size="lg"
                        class="font-semibold"
                        :data-testid="`${testidPrefix}-goto-login`"
                        @click="navigateTo('/auth/login')"
                    >
                        {{ $t('account.login') }}
                    </UButton>
                </div>

                <div
                    v-else
                    key="invalid"
                    class="text-center py-6"
                    :data-testid="`${testidPrefix}-invalid`"
                >
                    <UIcon
                        name="i-lucide-link-2-off"
                        class="mb-4 size-[48px] text-error"
                    />
                    <UButton
                        color="success"
                        variant="soft"
                        block
                        class="mt-4"
                        :data-testid="`${testidPrefix}-back`"
                        @click="navigateTo('/auth/login')"
                    >
                        {{ $t('actions.back_to_home') }}
                    </UButton>
                </div>
            </Transition>
        </div>
    </LayoutAuthLayout>
</template>

<script setup lang="ts">
type Step = 'form' | 'done' | 'invalid'

interface Heading {
    eyebrow: string
    title: string
    subtitle: string
}

const props = withDefaults(
    defineProps<{
        testidPrefix: string
        brandHeadline: 'login' | 'reset'
        formHeading: Heading
        doneTitle: string
        doneSubtitle: string
        invalidSubtitle: string
        action: (token: string) => Promise<unknown>
        auto?: boolean
        isTokenError?: (error: unknown) => boolean
        errorMessage?: string
    }>(),
    {
        auto: false,
        isTokenError: () => true,
        errorMessage: '',
    },
)

const { t } = useI18n()
const route = useRoute()
const { error: notifyError } = useNotification()

const token = String(route.params.token ?? '')
const step = ref<Step>(token ? 'form' : 'invalid')
const submitting = ref(false)
const loading = computed(
    () => submitting.value || (props.auto && step.value === 'form'),
)

const heading = computed<Heading>(() => {
    if (step.value === 'done') {
        return {
            eyebrow: t('account.eyebrowAllDone'),
            title: props.doneTitle,
            subtitle: props.doneSubtitle,
        }
    }
    if (step.value === 'invalid') {
        return {
            eyebrow: t('account.eyebrowInvalidLink'),
            title: t('account.linkInvalid'),
            subtitle: props.invalidSubtitle,
        }
    }
    return props.formHeading
})

async function submit() {
    submitting.value = true
    try {
        await props.action(token)
        step.value = 'done'
    } catch (error) {
        if (props.isTokenError(error)) step.value = 'invalid'
        else notifyError(props.errorMessage || t('notifications.error.unknown'))
    } finally {
        submitting.value = false
    }
}

onMounted(() => {
    if (props.auto && token) void submit()
})
</script>

<style scoped>
.success-ring {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    border: 2px solid color-mix(in oklab, var(--ui-success) 30%, transparent);
    background: color-mix(in oklab, var(--ui-success) 8%, transparent);
    margin: 0 auto 24px;
}
</style>
