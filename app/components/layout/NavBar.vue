<template>
    <UHeader
        v-if="$route.meta.navbar !== false"
        class="nav-bar"
        :toggle="false"
        :ui="{
            root: 'bg-default lg:bg-(--app-bg)/80 lg:backdrop-blur-md',
            container: 'max-w-none',
        }"
    >
        <template #left>
            <LayoutGymSwitcher class="max-w-[55vw] lg:hidden" />
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
                data-testid="nav-login"
            >
                {{ $t('routes.login') }}
            </UButton>
        </template>
    </UHeader>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { visibleNavItems } from '~/utils/navigation'

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
const { slug } = useGym()
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
