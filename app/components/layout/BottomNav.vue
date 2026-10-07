<template>
    <div class="bottom-nav lg:hidden">
        <UNavigationMenu
            :items="items"
            variant="link"
            :ui="{
                root: 'w-full [&>div]:w-full',
                list: 'grid w-full auto-cols-fr grid-flow-col',
                item: 'py-0',
                link: 'h-16 flex-col justify-center gap-1 px-0 before:hidden',
                linkLabel: 'w-full text-center text-[0.6875rem]',
            }"
            :aria-label="$t('nav.quickNavigation')"
            data-testid="bottom-nav"
        >
            <template #item-leading="{ item, active }">
                <span v-if="item.scan" class="bottom-nav__scan">
                    <UIcon :name="item.icon" class="size-7" />
                </span>
                <span
                    v-else
                    class="bottom-nav__pill"
                    :class="{ 'is-active': active }"
                >
                    <UAvatar
                        v-if="item.avatar"
                        v-bind="item.avatar"
                        size="xs"
                        class="size-7"
                        :ui="{
                            root: item.avatar.src ? '' : 'bg-primary',
                            fallback: 'text-inverted font-bold',
                        }"
                        :class="{ 'ring-2 ring-primary': active }"
                    />
                    <UIcon v-else :name="item.icon" class="size-6" />
                    <span
                        v-if="item.count"
                        class="bottom-nav__count"
                        :data-testid="`${item.testid}-count`"
                        >{{ item.count }}</span
                    >
                </span>
            </template>
            <template #item-label="{ item, active }">
                <span
                    class="bottom-nav__label"
                    :class="{ 'is-active': active, 'sr-only': item.scan }"
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
import { bottomNavLinks, navContext } from '~/utils/navigation'
import { nameInitials } from '~/utils/avatar'

const { t } = useI18n()
const route = useRoute()
const gymCookie = useGymCookie()
const { slug: gymSlug } = useGym()
const { can } = usePermissions()

const user = useAuthRecord()
const youTab = computed(() =>
    user.value
        ? {
              label: t('nav.you'),
              avatar: {
                  src:
                      usePbFileUrl(user.value, user.value.avatar, {
                          thumb: '100x100',
                      }) || undefined,
                  alt: '',
                  text: nameInitials(
                      [user.value.firstname, user.value.name]
                          .filter(Boolean)
                          .join(' ') || user.value.email,
                  ),
              },
          }
        : { label: t('routes.login'), icon: 'i-lucide-log-in' },
)

const { badges } = useModerationSummary()

const items = computed<NavigationMenuItem[]>(() =>
    bottomNavLinks(
        route.path,
        gymSlug.value || gymCookie.value || '',
        navContext(route.path, routeGymSlug(route.params)),
        can,
    ).map((link) => ({
        label: t(link.label),
        icon: link.icon,
        to: link.to,
        testid: `bottom-nav-${navTestId(link.path)}`,
        active: link.active,
        count: link.badge ? badges.value[link.badge] : undefined,
        scan: link.path === '/scan',
        ...(link.path === '/account' && youTab.value),
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
    position: relative;
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

.bottom-nav__scan {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    margin-top: -22px;
    border-radius: 9999px;
    background: var(--ui-primary);
    color: var(--ui-bg);
}

.bottom-nav__label {
    color: var(--ui-text-muted);
    font-weight: 500;
}

.bottom-nav__label.is-active {
    color: var(--ui-text-highlighted);
    font-weight: 700;
}

.bottom-nav__count {
    position: absolute;
    top: -2px;
    right: 6px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--ui-warning);
    color: var(--ui-bg);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
}
</style>
