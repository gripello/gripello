<template>
    <UDropdownMenu
        :items="items"
        :content="
            collapsed
                ? { side: 'right', align: 'start', sideOffset: 8 }
                : { align: 'start', sideOffset: 8 }
        "
        :ui="{ content: 'w-64 max-w-[calc(100vw-2rem)]' }"
        @update:open="(open) => open && loadGyms()"
    >
        <UButton
            color="neutral"
            variant="ghost"
            :block="!collapsed"
            :square="collapsed"
            class="min-w-0 rounded-md bg-elevated/60 ring ring-default data-[state=open]:bg-elevated"
            :class="collapsed ? 'mx-auto p-1' : 'justify-start gap-2 p-1.5'"
            :aria-label="
                currentGym ? `${title} · ${t('nav.allGyms')}` : t('nav.allGyms')
            "
            data-testid="gym-switcher"
        >
            <span
                class="flex min-w-0 items-center"
                :class="{ 'shrink-0': context !== 'platform' }"
                data-testid="nav-logo"
                :data-gym="currentGym?.slug"
                :data-context="context"
            >
                <img
                    v-if="logoUrl"
                    :src="logoUrl"
                    :alt="title"
                    class="gym-switcher__custom logo-mono"
                    :class="collapsed ? 'max-w-8' : 'max-w-20'"
                    data-testid="nav-logo-custom"
                />
                <img
                    v-else-if="currentGym || collapsed"
                    src="/app-icon.svg"
                    :alt="title"
                    class="size-8 rounded-md"
                />
                <template v-else>
                    <img
                        src="/gripello-light.svg"
                        :alt="title"
                        class="gym-switcher__brand gym-switcher__brand--light"
                        height="32"
                    />
                    <img
                        src="/gripello-dark.svg"
                        :alt="title"
                        class="gym-switcher__brand gym-switcher__brand--dark"
                        height="32"
                    />
                </template>
            </span>
            <UBadge
                v-if="!collapsed && context === 'platform'"
                color="primary"
                variant="soft"
                class="shrink-0"
                data-testid="gym-switcher-platform"
            >
                {{ $t('nav.platform') }}
            </UBadge>
            <span
                v-if="!collapsed && currentGym"
                class="line-clamp-2 min-w-0 flex-1 text-start text-sm leading-4 font-semibold break-words text-highlighted"
                data-testid="gym-switcher-name"
            >
                {{ title }}
            </span>
            <UIcon
                v-if="!collapsed"
                name="i-lucide-chevrons-up-down"
                class="ms-auto size-4 shrink-0 text-dimmed"
            />
        </UButton>

        <template #gym-trailing="{ item }">
            <UBadge
                v-if="(item as GymItem).role"
                color="neutral"
                variant="soft"
                size="sm"
            >
                {{ (item as GymItem).role }}
            </UBadge>
        </template>
    </UDropdownMenu>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GymRecord } from '~/types/models'
import { gymTitle } from '~/utils/gymNames'
import { gymSwitchPath, navContext } from '~/utils/navigation'
import { readRecentGyms } from '~/utils/recentGyms'

type GymItem = DropdownMenuItem & { role?: string }

defineProps<{ collapsed?: boolean }>()

const { t } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const { gym } = useGym()
const { gymMemberships, isPlatformAdmin } = usePermissions()

const context = computed(() =>
    navContext(route.path, routeGymSlug(route.params)),
)
const currentGym = computed(() =>
    context.value === 'gym' || context.value === 'staff' ? gym.value : null,
)
const title = computed(() =>
    currentGym.value ? gymTitle(currentGym.value) : 'Gripello',
)
const logoUrl = computed(() =>
    usePbFileUrl(currentGym.value, currentGym.value?.page_logo, {
        thumb: '0x200',
    }),
)

const recentSlugs = ref<string[]>([])
const { data: activeGyms, execute: fetchGyms } = useAsyncData(
    'gym-switcher-gyms',
    () =>
        pb.collection('gyms').getFullList<GymRecord>({
            filter: 'active = true',
            fields: 'id,collectionId,slug,name,unit_name,page_logo',
            sort: 'name',
            requestKey: null,
        }),
    { default: () => [], immediate: false, server: false },
)

function loadGyms() {
    recentSlugs.value = readRecentGyms()
    if (!activeGyms.value.length) void fetchGyms()
}

function switchTo(slug: string) {
    return navigateTo(
        route.params.gym
            ? gymSwitchPath(
                  route.path,
                  slug,
                  !!route.params.id || !!route.query.id,
              )
            : `/${slug}`,
    )
}

function gymItem(target: Partial<GymRecord>, role?: string): GymItem {
    const logo = usePbFileUrl(target, target.page_logo, { thumb: '100x100' })
    return {
        label: gymTitle(target),
        ...(logo
            ? { avatar: { src: logo, alt: '' } }
            : { icon: 'i-lucide-building-2' }),
        role,
        slot: 'gym' as const,
        active: target.slug === currentGym.value?.slug,
        'data-testid': `gym-switcher-item-${target.slug}`,
        onSelect: () => switchTo(target.slug!),
    }
}

const items = computed<DropdownMenuItem[][]>(() => {
    const mine = gymMemberships.value.flatMap((membership) =>
        membership.expand?.gym
            ? [gymItem(membership.expand.gym, membership.expand.role?.name)]
            : [],
    )
    const mineSlugs = new Set(
        gymMemberships.value.map((membership) => membership.expand?.gym?.slug),
    )
    const recent = recentSlugs.value
        .filter((slug) => !mineSlugs.has(slug))
        .flatMap((slug) => {
            const match = activeGyms.value.find((entry) => entry.slug === slug)
            return match ? [gymItem(match)] : []
        })
    return [
        mine.length
            ? [{ type: 'label' as const, label: t('landing.myGyms') }, ...mine]
            : [],
        recent.length
            ? [
                  { type: 'label' as const, label: t('landing.recent') },
                  ...recent,
              ]
            : [],
        [
            {
                label: t('nav.allGyms'),
                icon: 'i-lucide-search',
                to: '/',
                'data-testid': 'gym-switcher-all',
            },
            ...(isPlatformAdmin.value
                ? [
                      {
                          label: t('nav.platform'),
                          icon: 'i-lucide-building-2',
                          to: '/platform',
                          active: context.value === 'platform',
                          'data-testid': 'gym-switcher-platform-link',
                      },
                  ]
                : []),
        ],
    ].filter((group) => group.length)
})
</script>

<style scoped>
.gym-switcher__custom {
    max-height: 32px;
}

.gym-switcher__brand {
    min-width: 0;
    max-width: 120px;
    height: 32px;
    object-fit: contain;
    object-position: left;
}

.gym-switcher__brand--dark,
.dark .gym-switcher__brand--light {
    display: none;
}

.dark .gym-switcher__brand--dark {
    display: inline;
}
</style>
