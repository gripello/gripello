<template>
    <!-- The header clears the status bar like the nav bar (iPad app, installed PWA), so both dividers stay level. -->
    <USidebar
        v-if="!phone"
        :open="open"
        collapsible="icon"
        @update:open="keepOpenControlled"
        :ui="{
            container: staff ? 'z-40 bg-muted' : 'z-40 bg-default',
            header: 'flex-col items-stretch justify-center gap-2 px-3 pb-2 pt-[calc(0.5rem+var(--app-top-inset,0px))] min-h-[calc(var(--ui-header-height)+var(--app-top-inset,0px))]',
            body: 'p-0 overflow-hidden group-data-[state=collapsed]/sidebar:overflow-hidden',
            footer: 'p-3',
        }"
        data-testid="nav-sidebar"
        :data-context="context"
    >
        <template #header>
            <LayoutGymSwitcher :collapsed="!open" />
            <UButton
                v-if="staff"
                :to="staffExit"
                color="neutral"
                variant="soft"
                icon="i-lucide-arrow-left"
                :block="open"
                :square="!open"
                :aria-label="$t('nav.backToClimbing')"
                data-testid="nav-back-to-climbing"
            >
                <span v-if="open">{{ $t('nav.backToClimbing') }}</span>
            </UButton>
        </template>

        <div
            ref="scroller"
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
            :style="scrollShadow"
        >
            <UNavigationMenu
                :items="navLists"
                orientation="vertical"
                :collapsed="!open"
                tooltip
                :popover="coarsePointer ? { mode: 'click' } : true"
                highlight
                :aria-label="navLabel"
                :ui="{
                    link: 'py-2',
                    label: 'pt-3 text-xs font-semibold tracking-wide text-muted uppercase',
                    separator: 'my-2',
                }"
                data-testid="nav-desktop-links"
            >
                <template #item-label="{ item, active }">
                    <span
                        :class="{
                            'nav-link--active':
                                active || (item as SidebarItem).current,
                        }"
                        :data-testid="(item as SidebarItem).testid"
                    >
                        {{ item.label }}
                    </span>
                </template>
            </UNavigationMenu>
        </div>

        <template #footer>
            <div class="flex w-full min-w-0 flex-col gap-2">
                <UBadge
                    v-if="open && trial && roleName()"
                    :color="trial.ended ? 'warning' : 'info'"
                    variant="soft"
                    icon="i-lucide-hourglass"
                    class="self-start"
                    data-testid="nav-gym-trial"
                >
                    {{
                        trial.ended
                            ? $t('trial.readOnly')
                            : $t('trial.daysLeft', trial.daysLeft)
                    }}
                </UBadge>
                <UButton
                    v-if="staffEntry"
                    :to="staffEntry"
                    color="primary"
                    variant="soft"
                    icon="i-lucide-wrench"
                    :trailing-icon="open ? 'i-lucide-chevron-right' : undefined"
                    :block="open"
                    :square="!open"
                    :aria-label="$t('nav.staffTools')"
                    :ui="{ trailingIcon: 'ms-auto' }"
                    data-testid="nav-staff-tools"
                >
                    <span v-if="open">{{ $t('nav.staffTools') }}</span>
                </UButton>
                <LayoutFootBar
                    :settings="footerSettings"
                    :gym-slug="footerGymSlug"
                    :collapsed="!open"
                />
                <UserIcon v-if="loggedIn" :collapsed="!open" />
                <UButton
                    v-else
                    :to="{
                        path: '/auth/login',
                        query: { redirect: route.fullPath },
                    }"
                    color="primary"
                    variant="soft"
                    icon="i-lucide-log-in"
                    :block="open"
                    :square="!open"
                    :aria-label="$t('routes.login')"
                    data-testid="sidebar-login"
                >
                    <span v-if="open">{{ $t('routes.login') }}</span>
                </UButton>
            </div>
        </template>
    </USidebar>
</template>

<script setup lang="ts">
import { useMediaQuery, useMounted } from '@vueuse/core'
import { BREAKPOINTS } from '#shared/utils/breakpoints'
import type { NavigationMenuItem } from '@nuxt/ui'
import {
    navContext,
    sidebarSections,
    type SidebarItem,
} from '~/utils/navigation'
import { gymTitle } from '~/utils/gymNames'
import { gymTrial } from '~/utils/gymTrial'
import type { GymRecord, SettingsRecord } from '~/types/models'

const props = defineProps<{
    loggedIn: boolean
    footerSettings?: Partial<SettingsRecord> | Partial<GymRecord>
    footerGymSlug?: string
}>()

const { can, roleName } = usePermissions()
const { t } = useI18n()
const route = useRoute()

const { open } = useSidebar()
// Same query as USidebar's, so both agree on the breakpoint; below it its slide-over menu can get stuck open and phones use the bottom bar.
const desktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg / 16}rem)`)
const mounted = useMounted()
const phone = computed(() => mounted.value && !desktop.value)
// A listener makes USidebar's `open` model controlled; without it, crossing the mobile breakpoint leaves the rail collapsed while `open` is still true.
const keepOpenControlled = () => {}
const coarsePointer = useCoarsePointer()
const { gym, slug } = useGym()
const authStore = useAuthStore()

const scroller = useTemplateRef<HTMLElement>('scroller')
const { style: scrollShadow } = useScrollShadow(scroller)

const context = computed(() =>
    navContext(route.path, routeGymSlug(route.params)),
)
const staff = computed(() => context.value === 'staff')
const hydrated = useHydrated()
const trial = computed(() => (hydrated.value ? gymTrial(gym.value) : null))
const { badges } = useModerationSummary()
const nav = computed(() =>
    sidebarSections(
        can,
        props.loggedIn,
        slug.value,
        route.fullPath,
        t,
        context.value,
        authStore.record?.id,
        badges.value,
    ),
)
const staffEntry = computed(() => nav.value.staffEntry)
const navLists = computed(
    () =>
        nav.value.sections.map((section) => [
            ...(open.value
                ? [{ label: section.label, type: 'label' as const }]
                : []),
            ...section.items,
        ]) as NavigationMenuItem[][],
)
const navLabel = computed(() =>
    context.value !== 'platform' && gym.value
        ? gymTitle(gym.value)
        : t('nav.mainNavigation'),
)

const staffExit = useStaffExit()
</script>
