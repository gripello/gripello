<template>
    <UApp
        :toaster="{
            position: 'top-center',
            ui: { viewport: 'top-[calc(1rem+var(--app-top-inset,0px))]' },
        }"
    >
        <div class="app-root fontbody">
            <NuxtLoadingIndicator color="var(--ui-primary)" :height="3" />
            <NuxtAnnouncer />
            <LayoutPullToRefresh />
            <NuxtLayout>
                <NuxtPage />
            </NuxtLayout>
        </div>
    </UApp>
</template>

<script setup lang="ts">
const { locale } = useI18n()
useHead({ htmlAttrs: { lang: locale } })
useBrowserChrome()
</script>
