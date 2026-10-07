<template>
    <UHeader
        v-if="$route.meta.navbar !== false"
        class="nav-bar"
        :toggle="false"
        :ui="{
            root: 'h-auto bg-default lg:bg-(--app-bg)/80 lg:backdrop-blur-md',
            container: 'h-[calc(var(--ui-header-height)-1px)] max-w-none',
            left: 'min-w-0 flex-1',
            right: 'shrink-0',
        }"
    >
        <template #left>
            <NuxtLink
                v-if="context === 'staff'"
                :to="`/${slug}/routes`"
                class="flex min-h-11 min-w-0 items-center gap-2 rounded-full bg-elevated py-1 ps-3 pe-4 lg:hidden"
                :aria-label="`${$t('nav.backToClimbing')}: ${gymName}`"
                data-testid="nav-back-to-climbing-mobile"
            >
                <UIcon name="i-lucide-arrow-left" class="size-5 shrink-0" />
                <span class="flex min-w-0 flex-col leading-tight">
                    <span
                        class="text-[0.6875rem] font-semibold tracking-wide text-muted uppercase"
                        >{{ $t('nav.staff') }}</span
                    >
                    <span class="truncate text-sm font-bold text-highlighted">{{
                        gymName
                    }}</span>
                </span>
            </NuxtLink>
            <LayoutGymSwitcher v-else class="w-auto min-w-0 lg:hidden" />
            <UButton
                :icon="
                    sidebarOpen
                        ? 'i-lucide-panel-left-close'
                        : 'i-lucide-panel-left-open'
                "
                color="neutral"
                variant="ghost"
                size="xl"
                class="hidden lg:inline-flex"
                :aria-label="$t('nav.toggleSidebar')"
                :aria-expanded="sidebarOpen"
                data-testid="nav-sidebar-toggle"
                @click="toggleSidebar"
            />
        </template>

        <template #right>
            <LayoutCommandPalette :pages="paletteLinks" />
            <UDropdownMenu
                :items="themeItems"
                :content="{ align: 'end', sideOffset: 8 }"
                :ui="{ content: 'w-60' }"
            >
                <UButton
                    ref="themeButton"
                    :icon="themeModeIcon"
                    color="neutral"
                    variant="ghost"
                    size="xl"
                    :class="{ 'max-lg:hidden': loggedIn }"
                    data-testid="nav-theme-toggle"
                    :data-theme-mode="themeMode"
                    :aria-label="`${$t('nav.themeToggle')}: ${$t(themeModeLabel)}`"
                />
            </UDropdownMenu>
            <NotificationsBell v-if="loggedIn" />
            <UButton
                v-else
                to="/auth/login"
                variant="soft"
                icon="i-lucide-log-in"
                class="icon-btn whitespace-nowrap max-sm:px-1.5"
                :aria-label="$t('routes.login')"
                data-testid="nav-login"
            >
                <span class="max-sm:hidden">{{ $t('routes.login') }}</span>
            </UButton>
        </template>
        <template #bottom>
            <nav
                v-if="tabs.length"
                class="flex gap-1 overflow-x-auto border-t border-default px-4 py-2 lg:hidden"
                :aria-label="$t('nav.sections')"
                data-section-tabs
            >
                <UButton
                    v-for="tab in tabs"
                    :key="tab.to"
                    :to="tab.to"
                    :color="tab.active ? 'primary' : 'neutral'"
                    :variant="tab.active ? 'solid' : 'soft'"
                    :icon="tab.to === '/friends' ? tab.icon : undefined"
                    :aria-label="
                        tab.to === '/friends' && requests.length
                            ? `${$t(tab.label)}, ${$t('friends.tabs.requests')}: ${requests.length}`
                            : $t(tab.label)
                    "
                    size="sm"
                    class="shrink-0 rounded-full px-3"
                    :class="{ 'icon-btn': tab.to === '/friends' }"
                    :aria-current="tab.active ? 'page' : undefined"
                    :data-testid="tab.testid"
                >
                    <template v-if="tab.to !== '/friends'">{{
                        $t(tab.label)
                    }}</template>
                    <UBadge
                        v-else-if="requests.length"
                        :label="requests.length"
                        color="error"
                        size="sm"
                        class="rounded-full"
                    />
                </UButton>
            </nav>
        </template>
    </UHeader>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { navContext, sectionTabs, visibleNavItems } from '~/utils/navigation'
import { gymTitle } from '~/utils/gymNames'

const props = defineProps<{ loggedIn: boolean }>()

const { mode: themeMode, setMode } = useThemeMode()
const themeModeIcon = computed(
    () =>
        ({
            system: 'i-lucide-sun-moon',
            light: 'i-lucide-sun',
            dark: 'i-lucide-moon',
        })[themeMode.value],
)
const themeModeLabel = computed(
    () =>
        ({
            system: 'nav.themeSystem',
            light: 'nav.themeLight',
            dark: 'nav.themeDark',
        })[themeMode.value],
)

const themeButton = useTemplateRef<{ $el: HTMLElement }>('themeButton')
const themeItems = computed<DropdownMenuItem[]>(() =>
    (
        [
            ['light', 'i-lucide-sun', 'nav.themeLight'],
            ['dark', 'i-lucide-moon', 'nav.themeDark'],
            ['system', 'i-lucide-sun-moon', 'nav.themeSystem'],
        ] as const
    ).map(([value, icon, label]) => ({
        type: 'checkbox' as const,
        label: t(label),
        description: value === 'system' ? t('nav.themeSystemHint') : undefined,
        icon,
        checked: themeMode.value === value,
        onSelect: () => setMode(value, themeButton.value?.$el),
    })),
)

const { t } = useI18n()
const { can } = usePermissions()
const { gym, slug } = useGym()
const route = useRoute()
const context = computed(() =>
    navContext(route.path, routeGymSlug(route.params)),
)
const gymName = computed(() => (gym.value ? gymTitle(gym.value) : ''))
const tabs = computed(() => sectionTabs(route.path, slug.value, props.loggedIn))
const { requests } = useFollows()
const { open: sidebarOpen, toggle: toggleSidebar } = useSidebar()

const paletteLinks = computed(() =>
    visibleNavItems(can, props.loggedIn, slug.value).flatMap(
        (item) =>
            (item.children ?? [item]) as {
                to: string
                icon: string
                label: string
            }[],
    ),
)
</script>

<style scoped>
.nav-bar {
    padding-left: env(safe-area-inset-left, 0px);
    padding-right: env(safe-area-inset-right, 0px);
}
</style>
