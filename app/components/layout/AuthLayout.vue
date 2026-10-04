<template>
    <div class="grid min-h-dvh grid-cols-1 md:grid-cols-12">
        <div class="hidden md:flex md:col-span-5 brand-panel">
            <div class="brand-inner">
                <div class="brand-logo">
                    <span class="brand-avatar size-11">
                        <UIcon
                            name="i-lucide-shield-check"
                            class="size-6 text-success"
                        />
                    </span>
                    <div>
                        <div class="text-sm font-bold text-highlighted">
                            {{ orgName }}
                        </div>
                        <div class="text-xs text-muted">
                            {{ orgUnitName }}
                        </div>
                    </div>
                </div>
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
        </div>
        <div
            class="md:col-span-7 form-panel flex items-center justify-center p-6"
        >
            <div class="form-wrapper">
                <div class="flex md:hidden items-center gap-3 mb-8">
                    <span class="brand-avatar size-9">
                        <UIcon
                            name="i-lucide-shield-check"
                            class="size-5 text-success"
                        />
                    </span>
                    <div>
                        <div class="text-sm font-bold">
                            {{ orgName }}
                        </div>
                        <div class="text-xs text-muted">
                            {{ orgUnitName }}
                        </div>
                    </div>
                </div>
                <Transition name="txt-swap" mode="out-in">
                    <div :key="headingKey" class="mb-8">
                        <div
                            class="text-xs font-medium text-muted mb-1 text-eyebrow"
                        >
                            {{ eyebrow }}
                        </div>
                        <h2 class="text-2xl font-bold mb-1">
                            {{ title }}
                        </h2>
                        <p
                            class="text-sm text-muted"
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
                <LayoutLegalLinks
                    :settings="platformSettings ?? {}"
                    class="mt-8 justify-center"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { SettingsRecord } from '~/types/models'
defineOptions({ name: 'AuthLayout' })

const { data: platformSettings } = useNuxtData<SettingsRecord>('settings')

withDefaults(
    defineProps<{
        orgName?: string
        orgUnitName?: string
        loading?: boolean
        eyebrow?: string
        title?: string
        subtitle?: string
        headingKey?: string
    }>(),
    {
        orgName: 'Gripello',
        orgUnitName: '',
        loading: false,
        eyebrow: '',
        title: '',
        subtitle: '',
        headingKey: 'heading',
    },
)
</script>

<style scoped>
/* ─── Brand panel ──────────────────────────────────── */
.brand-panel {
    background: var(--ui-bg);
    border-right: 1px solid var(--ui-border);
    min-height: 100vh;
}

.brand-inner {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 52px 48px;
    height: 100%;
}

.brand-logo {
    display: flex;
    align-items: center;
    gap: 14px;
}

.brand-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 0.5rem;
    background: color-mix(in oklab, var(--ui-success) 10%, transparent);
    border: 1px solid color-mix(in oklab, var(--ui-success) 25%, transparent);
}

.brand-headline {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px 0;
}

.brand-title {
    font-size: clamp(2.4rem, 3.2vw, 3.2rem);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.025em;
}

/* ─── Form panel ───────────────────────────────────── */
.form-panel {
    background: var(--app-bg);
    min-height: 100vh;
}

.form-wrapper {
    width: 100%;
    max-width: 420px;
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
