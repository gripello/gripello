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
import robotsTxt from '~~/public/robots.txt?raw'
import { robotsAllows } from '#shared/utils/robots'
import { gymTitle, pageTitle } from '~/utils/gymNames'

const { locale, t } = useI18n()
const route = useRoute()
const { gym } = useGym()
useHead({
    htmlAttrs: { lang: locale },
    titleTemplate: (title?: string) =>
        pageTitle(
            routeGymSlug(route.params) && gym.value ? gymTitle(gym.value) : '',
            title,
        ),
    meta: () =>
        robotsAllows(robotsTxt, route.fullPath)
            ? []
            : [{ name: 'robots', content: 'noindex' }],
})
useSeoMeta({ description: () => t('seo.default') })
useBrowserChrome()
</script>
