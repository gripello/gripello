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

        <template v-else>
            <section
                v-for="section in sections"
                :key="section.key"
                class="mb-6"
                :data-testid="`landing-${section.key}`"
            >
                <LayoutSectionHeader :title="$t(section.title)" />
                <ul
                    class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                >
                    <li
                        v-for="gym in section.gyms"
                        :key="gym.id"
                        class="min-w-0"
                    >
                        <NuxtLink
                            :to="`/${gym.slug}`"
                            class="landing-gym surface-card min-w-0"
                            :data-testid="`landing-gym-${gym.slug}`"
                        >
                            <img
                                v-if="gym.page_logo"
                                :src="
                                    usePbFileUrl(gym, gym.page_logo, {
                                        thumb: '0x200',
                                    })
                                "
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
                        </NuxtLink>
                    </li>
                </ul>
            </section>

            <LayoutEmptyState
                v-if="!matching.length"
                icon="i-lucide-search-x"
                :title="$t('landing.empty')"
                data-testid="landing-empty"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import { readRecentGyms } from '~/utils/recentGyms'
import { gymSubtitle, gymTitle, landingSections } from '~/utils/gymNames'

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
            fields: 'id,collectionId,slug,name,unit_name,page_logo',
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
