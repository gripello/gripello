<template>
    <div class="mx-auto w-full p-4" data-testid="gym-info-page">
        <div
            v-if="coverUrl"
            class="relative mb-4 overflow-hidden rounded-lg bg-elevated"
        >
            <img
                :src="coverUrl"
                :alt="title"
                class="aspect-[16/5] w-full object-cover"
                data-testid="gym-info-cover"
            />
        </div>

        <LayoutPageHeader :title="title" :subtitle="subtitle" inline-actions>
            <template v-if="hasHours" #actions>
                <UBadge
                    v-if="status"
                    :color="status.open ? 'success' : 'neutral'"
                    variant="soft"
                    size="lg"
                    icon="i-lucide-clock"
                    :label="statusLabel"
                    data-testid="gym-info-status"
                />
            </template>
        </LayoutPageHeader>

        <LayoutEmptyState
            v-if="!hasGymInfo(gym)"
            icon="i-lucide-info"
            :title="$t('gymInfo.empty')"
            data-testid="gym-info-empty"
        />

        <div v-else class="grid gap-4 lg:grid-cols-3">
            <div class="flex flex-col gap-4 lg:col-span-2">
                <UCard v-if="gym?.description">
                    <p
                        class="whitespace-pre-line"
                        data-testid="gym-info-description"
                    >
                        {{ gym.description }}
                    </p>
                </UCard>

                <UCard v-if="gym?.address || located">
                    <template #header>
                        <h2 class="font-semibold">
                            {{ $t('gymInfo.location') }}
                        </h2>
                    </template>
                    <div class="flex flex-col gap-3">
                        <p
                            v-if="gym?.address"
                            class="flex gap-2 whitespace-pre-line"
                            data-testid="gym-info-address"
                        >
                            <UIcon
                                name="i-lucide-map-pin"
                                class="mt-0.5 size-5 shrink-0 text-muted"
                            />
                            {{ gym.address }}
                        </p>
                        <GymLocationMap v-if="located" :markers="markers" />
                        <GymDirectionsButton
                            v-if="located && gym"
                            :gym="gym"
                            class="self-start"
                        />
                    </div>
                </UCard>

                <UCard v-if="gym?.amenities?.length">
                    <template #header>
                        <h2 class="font-semibold">
                            {{ $t('gymInfo.amenitiesTitle') }}
                        </h2>
                    </template>
                    <ul
                        class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
                        data-testid="gym-info-amenities"
                    >
                        <li
                            v-for="amenity in gym.amenities"
                            :key="amenity"
                            class="flex items-center gap-2"
                            :data-testid="`gym-amenity-${amenity}`"
                        >
                            <UIcon
                                :name="GYM_AMENITIES[amenity]"
                                class="size-5 shrink-0 text-primary"
                            />
                            {{ $t(`gymInfo.amenities.${amenity}`) }}
                        </li>
                    </ul>
                </UCard>
            </div>

            <div class="order-first flex flex-col gap-4 lg:order-none">
                <UCard v-if="hasHours" data-testid="gym-info-hours">
                    <template #header>
                        <h2 class="font-semibold">
                            {{ $t('gymInfo.hoursTitle') }}
                        </h2>
                    </template>
                    <GymHoursList :hours="gym?.opening_hours" :today="today" />
                    <p
                        v-if="gym?.hours_note"
                        class="mt-3 text-sm whitespace-pre-line"
                        data-testid="gym-info-hours-note"
                    >
                        {{ gym.hours_note }}
                    </p>
                </UCard>

                <UCard v-if="contacts.length">
                    <template #header>
                        <h2 class="font-semibold">
                            {{ $t('gymInfo.contact') }}
                        </h2>
                    </template>
                    <ul class="flex flex-col gap-1">
                        <li v-for="contact in contacts" :key="contact.key">
                            <UButton
                                :href="contact.href"
                                :target="
                                    contact.key === 'website'
                                        ? '_blank'
                                        : undefined
                                "
                                rel="noopener"
                                color="neutral"
                                variant="link"
                                :icon="contact.icon"
                                :label="contact.label"
                                class="px-0 break-all"
                                :data-testid="`gym-info-${contact.key}`"
                            />
                        </li>
                    </ul>
                </UCard>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { GYM_AMENITIES } from '#shared/utils/gymAmenities'
import { hasOpeningHours, toSchemaOrgHours } from '#shared/utils/openingHours'
import {
    gymContacts,
    gymMarkers,
    hasGymInfo,
    hasLocation,
} from '~/utils/gymInfo'
import { gymSubtitle, gymTitle } from '~/utils/gymNames'

const { t } = useI18n()
const { gym } = useGym()
const requestUrl = useRequestURL()
const title = computed(() => (gym.value ? gymTitle(gym.value) : ''))
const subtitle = computed(() => (gym.value ? gymSubtitle(gym.value) : ''))

const coverUrl = computed(() =>
    gym.value?.cover_image
        ? usePbFileUrl(gym.value, gym.value.cover_image, {
              thumb: '1600x500',
          })
        : '',
)
const located = computed(() => hasLocation(gym.value))
const markers = computed(() =>
    gym.value
        ? gymMarkers([gym.value], (g) =>
              g.page_logo
                  ? usePbFileUrl(g, g.page_logo, { thumb: '0x200' })
                  : '',
          )
        : [],
)

const hasHours = computed(() => hasOpeningHours(gym.value?.opening_hours))
const {
    status,
    today,
    label: statusLabel,
} = useOpenStatus(() => gym.value?.opening_hours)

const contacts = computed(() => (gym.value ? gymContacts(gym.value) : []))

useSeoMeta({
    title: () => t('page.title.info'),
    ogTitle: () => t('gymInfo.title', { name: title.value }),
    description: () => gym.value?.description?.slice(0, 160),
    ogDescription: () => gym.value?.description?.slice(0, 160),
})

useHead({
    script: computed(() =>
        gym.value
            ? [
                  {
                      type: 'application/ld+json',
                      innerHTML: JSON.stringify({
                          '@context': 'https://schema.org',
                          '@type': 'SportsActivityLocation',
                          name: title.value,
                          description: gym.value.description || undefined,
                          address: gym.value.address || undefined,
                          telephone: gym.value.legal_phone || undefined,
                          email: gym.value.contact_email || undefined,
                          url: gym.value.website_url || undefined,
                          image: coverUrl.value
                              ? new URL(coverUrl.value, requestUrl).href
                              : undefined,
                          geo: located.value
                              ? {
                                    '@type': 'GeoCoordinates',
                                    latitude: gym.value.latitude,
                                    longitude: gym.value.longitude,
                                }
                              : undefined,
                          openingHoursSpecification: toSchemaOrgHours(
                              gym.value.opening_hours,
                          ),
                          amenityFeature: gym.value.amenities?.map(
                              (amenity) => ({
                                  '@type': 'LocationFeatureSpecification',
                                  name: t(`gymInfo.amenities.${amenity}`),
                                  value: true,
                              }),
                          ),
                      }).replace(/</g, '\\u003c'),
                  },
              ]
            : [],
    ),
})
</script>
