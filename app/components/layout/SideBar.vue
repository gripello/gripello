<template>
    <USidebar
        :open="open"
        collapsible="icon"
        :ui="{
            container: 'z-40 bg-default',
            header: 'px-3',
            body: 'p-0 overflow-hidden group-data-[state=collapsed]/sidebar:overflow-hidden',
            footer: 'p-3',
        }"
        data-testid="nav-sidebar"
    >
        <template #header>
            <LayoutGymSwitcher :collapsed="!open" />
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
                :aria-label="$t('nav.mainNavigation')"
                :ui="{ link: 'py-2', separator: 'my-2' }"
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
import { sidebarItems, type SidebarItem } from '~/utils/navigation'
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
const coarsePointer = useCoarsePointer()
const { slug } = useGym()

const scroller = useTemplateRef<HTMLElement>('scroller')
const { style: scrollShadow } = useScrollShadow(scroller)

const navLists = computed(
    () =>
        sidebarItems(
            can,
            props.loggedIn,
            slug.value,
            route.path,
            t,
        ) as NavigationMenuItem[][],
)
</script>
