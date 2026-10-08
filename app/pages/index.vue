<template>
    <div class="w-full p-4" data-testid="landing">
        <LayoutPageHeader :title="$t('landing.title')">
            <template v-if="isPlatformAdmin" #actions>
                <UButton
                    to="/platform/gyms"
                    variant="link"
                    color="neutral"
                    icon="i-lucide-building-2"
                    data-testid="landing-platform-link"
                >
                    {{ $t('nav.manageGyms') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <UInput
            v-model="search"
            icon="i-lucide-search"
            size="xl"
            class="mb-6 w-full"
            :placeholder="$t('landing.search')"
            :aria-label="$t('landing.search')"
            data-testid="landing-search"
        />

        <LayoutEmptyState
            v-if="error"
            variant="error"
            :title="$t('errors.loadFailed')"
        >
            <template #actions>
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-refresh-cw"
                    @click="refresh()"
                >
                    {{ $t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <div
            v-else
            class="grid gap-4"
            :class="hasMap && 'lg:grid-cols-[minmax(320px,420px)_1fr]'"
        >
            <GymLocationMap
                v-if="hasMap"
                :markers="markers"
                :zoom="13"
                :selected="selectedId"
                class="lg:sticky lg:top-4 lg:order-last lg:h-[calc(100dvh-var(--app-top,64px)-11rem)]"
                @select="selectedId = $event"
            >
                <GymMapCard
                    v-if="selected"
                    :gym="selected"
                    @close="selectedId = null"
                />
            </GymLocationMap>
            <div
                class="min-w-0"
                :class="
                    hasMap &&
                    'lg:h-[calc(100dvh-var(--app-top,64px)-11rem)] lg:overflow-y-auto'
                "
            >
                <section
                    v-for="section in sections"
                    :key="section.key"
                    class="mb-6"
                    :data-testid="`landing-${section.key}`"
                >
                    <LayoutSectionHeader :title="$t(section.title)" />
                    <ul
                        class="grid grid-cols-1 gap-3 sm:grid-cols-2"
                        :class="hasMap ? 'lg:grid-cols-1' : 'xl:grid-cols-3'"
                    >
                        <li
                            v-for="gym in section.gyms"
                            :key="gym.id"
                            class="surface-card flex min-w-0 items-center"
                            :class="
                                gym.id === selectedId && 'ring-2 ring-primary'
                            "
                        >
                            <NuxtLink
                                :to="`/${gym.slug}`"
                                class="landing-gym min-w-0 flex-1"
                                :data-testid="`landing-gym-${gym.slug}`"
                            >
                                <img
                                    v-if="gym.page_logo"
                                    :src="logoUrl(gym)"
                                    alt=""
                                    class="landing-gym__logo"
                                />
                                <UIcon
                                    v-else
                                    name="i-lucide-building-2"
                                    class="landing-gym__logo text-muted"
                                />
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate font-semibold">
                                        {{ gymTitle(gym) }}
                                    </span>
                                    <span
                                        v-if="gymSubtitle(gym)"
                                        class="block truncate text-sm text-muted"
                                    >
                                        {{ gymSubtitle(gym) }}
                                    </span>
                                </span>
                                <GymOpenBadge :hours="gym.opening_hours" />
                            </NuxtLink>
                            <UButton
                                v-if="hasLocation(gym)"
                                icon="i-lucide-map-pin"
                                color="neutral"
                                variant="ghost"
                                class="icon-btn me-2"
                                :aria-label="`${$t('landing.showOnMap')}: ${gymTitle(gym)}`"
                                :data-testid="`landing-gym-locate-${gym.slug}`"
                                @click="selectGym(gym.id)"
                            />
                        </li>
                    </ul>
                </section>

                <LayoutEmptyState
                    v-if="!matching.length"
                    icon="i-lucide-search-x"
                    :title="$t('landing.empty')"
                    data-testid="landing-empty"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import { readRecentGyms } from '~/utils/recentGyms'
import { gymSubtitle, gymTitle, landingSections } from '~/utils/gymNames'
import { gymMarkers, hasLocation } from '~/utils/gymInfo'

const { t } = useI18n()
const pb = usePocketbase()
const { gymMemberships, isPlatformAdmin } = usePermissions()
const search = ref('')
const recentSlugs = ref<string[]>([])
onMounted(() => (recentSlugs.value = readRecentGyms()))

const {
    data: gyms,
    error,
    refresh,
} = await useAsyncData(
    'landing-gyms',
    () =>
        pb.collection('gyms').getFullList<GymRecord>({
            filter: 'active = true',
            fields: 'id,collectionId,slug,name,unit_name,page_logo,cover_image,latitude,longitude,opening_hours,hours_note,address,legal_phone,contact_email,website_url,amenities',
            sort: 'name',
            requestKey: null,
        }),
    { default: () => [] },
)

const onlyGym = gyms.value.length === 1 ? gyms.value[0] : undefined
if (
    import.meta.server &&
    onlyGym &&
    !pb.authStore.isValid &&
    !useGymCookie().value
)
    await navigateTo(`/${onlyGym.slug}`, { redirectCode: 302 })

const matching = computed(() => {
    const term = search.value.trim().toLowerCase()
    return gyms.value.filter((gym) =>
        `${gym.name} ${gym.unit_name ?? ''}`.toLowerCase().includes(term),
    )
})

const logoUrl = (gym: GymRecord) =>
    gym.page_logo ? usePbFileUrl(gym, gym.page_logo, { thumb: '0x200' }) : ''
const markers = computed(() => gymMarkers(matching.value, logoUrl))
const hasMap = computed(() => markers.value.length > 0)

const selectedId = ref<string | null>(null)
const selected = computed(() =>
    matching.value.find((gym) => gym.id === selectedId.value),
)
function selectGym(id: string) {
    selectedId.value = id
    document
        .querySelector('[data-testid="gym-location-map"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

const sections = computed(() =>
    landingSections(
        matching.value,
        gymMemberships.value.map((membership) => membership.expand?.gym?.slug),
        recentSlugs.value,
    ),
)

useSeoMeta({
    title: () => t('landing.title'),
    ogTitle: () => t('landing.title'),
    ogType: 'website',
})
</script>

<style scoped>
.landing-gym {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    min-height: 64px;
    text-decoration: none;
    color: inherit;
}

.landing-gym__logo {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    object-fit: contain;
}
</style>
