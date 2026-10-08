<template>
    <UApp>
        <div class="app-root fontbody">
            <NuxtLayout>
                <div class="error-page flex items-center justify-center px-4">
                    <div class="text-center" data-testid="error-page">
                        <div
                            class="error-ring"
                            :class="{ 'error-ring--danger': !isNotFound }"
                        >
                            <UIcon
                                :name="
                                    isNotFound
                                        ? 'i-lucide-map-pin'
                                        : 'i-lucide-circle-alert'
                                "
                                class="size-[40px]"
                                :class="
                                    isNotFound ? 'text-success' : 'text-error'
                                "
                            />
                        </div>

                        <div
                            class="text-xs font-medium text-muted mb-2 text-eyebrow"
                            data-testid="error-status"
                        >
                            {{ $t('errors.eyebrow', { code: status }) }}
                        </div>

                        <div class="error-code" aria-hidden="true">
                            {{ status }}
                        </div>

                        <h1 class="text-2xl font-bold mb-2">
                            {{ title }}
                            <span v-if="isNotFound" class="block text-success">
                                {{ $t('errors.notFound.accent') }}
                            </span>
                        </h1>
                        <p class="text-sm text-muted mb-8">
                            {{ subtitle }}
                        </p>

                        <div class="flex flex-wrap justify-center gap-3">
                            <UButton
                                color="primary"
                                size="xl"
                                icon="i-lucide-house"
                                class="font-semibold"
                                data-testid="error-home"
                                @click="goHome"
                            >
                                {{ $t('actions.back_to_home') }}
                            </UButton>
                            <UButton
                                v-if="isNotFound"
                                variant="ghost"
                                color="neutral"
                                size="xl"
                                icon="i-lucide-arrow-left"
                                data-testid="error-back"
                                @click="goBack"
                            >
                                {{ $t('errors.goBack') }}
                            </UButton>
                            <UButton
                                v-else
                                variant="ghost"
                                color="neutral"
                                size="xl"
                                icon="i-lucide-refresh-cw"
                                data-testid="error-retry"
                                @click="retry"
                            >
                                {{ $t('errors.retry') }}
                            </UButton>
                        </div>
                    </div>
                </div>
            </NuxtLayout>
        </div>
    </UApp>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const { t, locale } = useI18n()
const router = useRouter()

const status = computed(() => props.error.status ?? 500)
const isNotFound = computed(() => status.value === 404)
const title = computed(() =>
    isNotFound.value ? t('errors.notFound.title') : t('errors.server.title'),
)
const unknownGym = computed(
    () =>
        (props.error.data as { reason?: string } | undefined)?.reason === 'gym',
)
const subtitle = computed(() => {
    if (unknownGym.value) return t('gym.notFound')
    return isNotFound.value
        ? t('errors.notFound.subtitle')
        : t('errors.server.subtitle')
})

const goHome = () => clearError({ redirect: '/' })
const retry = () => reloadNuxtApp()
const goBack = () =>
    window.history.length > 1
        ? clearError().then(() => router.back())
        : clearError({ redirect: '/' })

useBrowserChrome()
useHead({
    htmlAttrs: { lang: locale },
    title: computed(() =>
        isNotFound.value ? t('page.title.notFound') : title.value,
    ),
})
</script>

<style scoped>
.error-page {
    min-height: 70vh;
}

.error-ring {
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

.error-ring--danger {
    border-color: color-mix(in oklab, var(--ui-error) 30%, transparent);
    background: color-mix(in oklab, var(--ui-error) 8%, transparent);
}

.error-code {
    font-size: clamp(4.5rem, 14vw, 7.5rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.04em;
    margin-bottom: 16px;
    color: color-mix(in oklab, var(--ui-text-highlighted) 12%, transparent);
}
</style>
