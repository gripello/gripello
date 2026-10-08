<template>
    <USidebar
        :open="open"
        collapsible="icon"
        @update:open="keepOpenControlled"
        :ui="{
            container: staff ? 'z-40 bg-muted' : 'z-40 bg-default',
            header: 'flex-col items-stretch justify-center gap-2 px-3 py-2',
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
                :to="`/${slug}/routes`"
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
            </div>
        </template>
    </USidebar>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import {
    navContext,
    sidebarSections,
    type SidebarItem,
} from '~/utils/navigation'
import { gymTitle } from '~/utils/gymNames'
import type { GymRecord, SettingsRecord } from '~/types/models'

const props = defineProps<{
    loggedIn: boolean
    footerSettings?: Partial<SettingsRecord> | Partial<GymRecord>
    footerGymSlug?: string
}>()

const { can } = usePermissions()
const { t } = useI18n()
const route = useRoute()

const { open } = useSidebar()
// A listener makes USidebar's `open` model controlled; without it, crossing the mobile breakpoint leaves the rail collapsed while `open` is still true.
const keepOpenControlled = () => {}
const coarsePointer = useCoarsePointer()
const { gym, slug } = useGym()
const pb = usePocketbase()

const scroller = useTemplateRef<HTMLElement>('scroller')
const { style: scrollShadow } = useScrollShadow(scroller)

const context = computed(() =>
    navContext(route.path, routeGymSlug(route.params)),
)
const staff = computed(() => context.value === 'staff')
const { badges } = useModerationSummary()
const nav = computed(() =>
    sidebarSections(
        can,
        props.loggedIn,
        slug.value,
        route.path,
        t,
        context.value,
        pb.authStore.record?.id,
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
</script>
