<template>
    <div class="bottom-nav lg:hidden">
        <UNavigationMenu
            :items="items"
            variant="link"
            :ui="{
                root: 'w-full [&>div]:w-full',
                list: 'grid w-full grid-cols-4',
                item: 'py-0',
                link: 'h-16 flex-col justify-center gap-1 px-0 before:hidden',
                linkLabel: 'text-[0.75rem] tracking-wide',
            }"
            :aria-label="$t('nav.quickNavigation')"
            data-testid="bottom-nav"
        >
            <template #item-leading="{ item, active }">
                <span class="bottom-nav__pill" :class="{ 'is-active': active }">
                    <UIcon :name="item.icon" class="size-6" />
                </span>
            </template>
            <template #item-label="{ item, active }">
                <span
                    class="bottom-nav__label"
                    :class="{ 'is-active': active }"
                    :data-testid="item.testid"
                >
                    {{ item.label }}
                </span>
            </template>
        </UNavigationMenu>
    </div>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { BOTTOM_NAV } from '~/utils/navigation'

const { t } = useI18n()
const route = useRoute()
const gymCookie = useGymCookie()
const { slug: gymSlug } = useGym()

function linkTarget(to: string) {
    if (to !== '/map') return to
    const slug = gymSlug.value || gymCookie.value
    return slug ? `/${slug}/map` : '/'
}
const items = computed<NavigationMenuItem[]>(() =>
    BOTTOM_NAV.map((link) => ({
        label: t(link.label),
        icon: link.icon,
        to: linkTarget(link.to),
        testid: `bottom-nav-${navTestId(link.to)}`,
        active:
            link.to === '/account'
                ? route.path === '/account'
                : link.to === '/map'
                  ? /^\/[^/]+\/map$/.test(route.path)
                  : route.path.startsWith(link.to),
    })),
)
</script>

<style scoped>
.bottom-nav {
    position: fixed;
    inset: auto 0 0;
    z-index: 40;
    background: var(--ui-bg);
    border-top: 1px solid var(--ui-border);
    box-shadow: 0 -4px 16px -8px rgb(0 0 0 / 0.12);
    padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
        env(safe-area-inset-left, 0px);
}

.dark .bottom-nav {
    box-shadow: 0 -4px 16px -8px rgb(0 0 0 / 0.5);
}

.bottom-nav__pill {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 32px;
    border-radius: 16px;
    color: var(--ui-text-muted);
    transition:
        background-color 0.2s ease,
        color 0.2s ease,
        transform 0.2s ease;
}

.bottom-nav__pill.is-active {
    background: color-mix(in oklab, var(--ui-primary) 16%, transparent);
    color: var(--ui-primary);
}

.bottom-nav__label {
    color: var(--ui-text-muted);
    font-weight: 500;
}

.bottom-nav__label.is-active {
    color: var(--ui-text-highlighted);
    font-weight: 700;
}
</style>
