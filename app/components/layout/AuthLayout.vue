<template>
    <div class="grid min-h-dvh grid-cols-1 md:grid-cols-12">
        <div class="hidden md:flex md:col-span-5 xl:col-span-6 brand-panel">
            <div class="brand-headline">
                <div
                    class="text-xs font-medium text-success mb-3 text-eyebrow"
                    data-testid="auth-brand-eyebrow"
                >
                    {{ $t('account.eyebrowBrand') }}
                </div>
                <h1
                    class="brand-title text-highlighted"
                    data-testid="auth-brand-title"
                >
                    <slot name="brand-headline" />
                </h1>
            </div>
        </div>
        <div
            class="md:col-span-7 xl:col-span-6 flex justify-center px-4 pt-[calc(var(--app-top-inset,0px)+0.5rem)] pb-[calc(var(--app-bottom-inset,0px)+1rem)] md:p-6"
        >
            <div class="form-wrapper flex flex-col">
                <div class="md:my-auto">
                    <div class="mb-6 flex min-h-11 items-center gap-2 md:mb-8">
                        <UButton
                            v-if="backTo"
                            icon="i-lucide-arrow-left"
                            color="neutral"
                            variant="ghost"
                            size="xl"
                            class="icon-btn -ms-2"
                            :aria-label="$t('errors.goBack')"
                            data-testid="auth-back"
                            @click="goBack"
                        />
                        <LayoutBrandLogo />
                        <span
                            v-if="orgUnitName"
                            class="ms-1 truncate text-sm font-semibold text-muted"
                        >
                            {{ orgUnitName }}
                        </span>
                    </div>
                    <Transition name="txt-swap" mode="out-in">
                        <div
                            :key="headingKey"
                            class="mb-6 max-md:mt-[8dvh] md:mb-8"
                        >
                            <div
                                v-if="eyebrow"
                                class="text-xs font-medium text-muted mb-1 text-eyebrow max-md:hidden"
                            >
                                {{ eyebrow }}
                            </div>
                            <h2 class="text-2xl font-bold">
                                {{ title }}
                            </h2>
                            <p
                                v-if="subtitle"
                                class="mt-1 text-sm text-muted"
                                data-testid="auth-subtitle"
                            >
                                {{ subtitle }}
                            </p>
                        </div>
                    </Transition>
                    <UProgress
                        v-if="loading"
                        color="success"
                        size="2xs"
                        class="mb-6"
                    />
                    <slot />
                </div>
                <LayoutLegalLinks
                    :settings="platformSettings ?? {}"
                    class="mt-auto justify-center pt-8"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'
import { requiresSignIn } from '~/utils/authView'
defineOptions({ name: 'AuthLayout' })

const { data: platformSettings } = useNuxtData<SettingsRecord>('settings')

const props = withDefaults(
    defineProps<{
        orgUnitName?: string
        backTo?: string
        loading?: boolean
        eyebrow?: string
        title?: string
        subtitle?: string
        headingKey?: string
    }>(),
    {
        orgUnitName: '',
        backTo: '',
        loading: false,
        eyebrow: '',
        title: '',
        subtitle: '',
        headingKey: 'heading',
    },
)

const router = useRouter()

function goBack() {
    const back = window.history.state?.back
    if (back && !requiresSignIn(router.resolve(back).meta.middleware))
        return router.back()
    void navigateTo(props.backTo, { replace: true })
}
</script>

<style scoped>
/* ─── Brand panel ──────────────────────────────────── */
.brand-panel {
    background-color: var(--ui-bg);
    background-image:
        radial-gradient(
            ellipse 90% 60% at 0% 100%,
            color-mix(in oklab, var(--ui-success) 16%, transparent),
            transparent 70%
        ),
        radial-gradient(
            ellipse 60% 40% at 100% 0%,
            color-mix(in oklab, var(--ui-success) 7%, transparent),
            transparent 70%
        );
    border-right: 1px solid var(--ui-border);
}

.brand-headline {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: clamp(48px, 7vw, 128px);
}

.brand-title {
    max-width: 12ch;
    font-size: clamp(2.6rem, 4.4vw, 5.25rem);
    font-weight: 800;
    line-height: 1.04;
    letter-spacing: -0.03em;
}

.form-wrapper {
    width: 100%;
    max-width: 440px;
}

/* ─── Transitions ──────────────────────────────────── */
.txt-swap-enter-active,
.txt-swap-leave-active {
    transition:
        opacity 0.18s ease,
        transform 0.18s ease;
}
.txt-swap-enter-from {
    opacity: 0;
    transform: translateY(8px);
}
.txt-swap-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}
</style>
