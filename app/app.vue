<template>
    <UApp
        :locale="uiLocale"
        :toaster="{
            position: 'top-center',
            ui: { viewport: 'top-[calc(1rem+var(--app-top-inset,0px))]' },
        }"
    >
        <div class="app-root fontbody">
            <NuxtLoadingIndicator color="var(--ui-primary)" :height="3" />
            <NuxtAnnouncer />
            <NuxtLayout>
                <NuxtPage />
            </NuxtLayout>
        </div>
    </UApp>
</template>

<script setup lang="ts">
import { de, en, ru, tr, uk } from '@nuxt/ui/locale'

const UI_LOCALES = { de, en, ru, tr, uk }

const { locale } = useI18n()
const uiLocale = computed(
    () => UI_LOCALES[locale.value as keyof typeof UI_LOCALES] ?? en,
)
useHead({ htmlAttrs: { lang: locale } })
useBrowserChrome()
</script>
