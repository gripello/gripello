<template>
    <div class="mx-auto w-full p-4" data-testid="gym-info-page">
        <div
            v-if="coverUrl"
            class="relative mb-4 overflow-hidden rounded-lg bg-elevated"
        >
            <img
                :src="coverUrl"
                :srcset="thumbSrcset(coverUrl, THUMB_SETS.cover)"
                sizes="100vw"
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

        <div v-else class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <div class="flex flex-col gap-4 lg:col-span-2">
                <LayoutPanel v-if="gym?.description">
                    <p
                        class="whitespace-pre-line"
                        data-testid="gym-info-description"
                    >
                        {{ gym.description }}
                    </p>
                </LayoutPanel>

                <LayoutPanel
                    v-if="hasHours"
                    data-testid="gym-info-hours"
                    :title="$t('gymInfo.hoursTitle')"
                >
                    <GymWeekHours :hours="gym?.opening_hours" :today="today" />
                    <p
                        v-if="gym?.hours_note"
                        class="text-sm whitespace-pre-line"
                        data-testid="gym-info-hours-note"
                    >
                        {{ gym.hours_note }}
                    </p>
                </LayoutPanel>

                <LayoutPanel
                    v-if="gym?.address || located"
                    :title="$t('gymInfo.location')"
                >
                    <GymAddressBlock v-if="gym" :gym="gym" />
                    <GymLocationMap v-if="located" :markers="markers" />
                </LayoutPanel>
            </div>

            <div class="flex flex-col gap-4">
                <LayoutPanel
                    v-if="contacts.length || gym?.contacts?.length || appEmail"
                    :title="$t('gymInfo.contact')"
                >
                    <div class="flex flex-col gap-5 text-sm">
                        <GymContactLinks
                            v-if="contacts.length"
                            :links="contacts"
                            test-id-prefix="gym-info"
                        />
                        <div
                            v-for="(contact, index) in gym?.contacts"
                            :key="index"
                            :data-testid="`gym-info-contact-${index}`"
                        >
                            <LayoutEyebrow class="flex items-center gap-1.5">
                                <UIcon
                                    :name="GYM_CONTACT_KINDS[contact.kind]"
                                    class="size-3.5"
                                />
                                {{
                                    contact.label ||
                                    $t(`gymInfo.contactKinds.${contact.kind}`)
                                }}
                            </LayoutEyebrow>
                            <p
                                v-if="contact.name"
                                class="mb-2 font-medium text-highlighted"
                            >
                                {{ contact.name }}
                            </p>
                            <GymContactLinks
                                :links="contactLinks(contact)"
                                :test-id-prefix="`gym-info-contact-${index}`"
                            />
                        </div>
                        <div v-if="appEmail" data-testid="gym-info-app-contact">
                            <LayoutEyebrow class="flex items-center gap-1.5">
                                <UIcon
                                    name="i-lucide-smartphone"
                                    class="size-3.5"
                                />
                                {{ $t('gymInfo.appContact') }}
                            </LayoutEyebrow>
                            <GymContactLinks
                                :links="contactLinks({ email: appEmail })"
                                test-id-prefix="gym-info-app"
                            />
                        </div>
                    </div>
                </LayoutPanel>

                <LayoutPanel
                    v-if="gym?.amenities?.length"
                    :title="$t('gymInfo.amenitiesTitle')"
                >
                    <ul
                        class="grid grid-cols-2 gap-3 text-sm"
                        data-testid="gym-info-amenities"
                    >
                        <li
                            v-for="amenity in gym.amenities"
                            :key="amenity"
                            class="flex min-w-0 items-center gap-2"
                            :data-testid="`gym-amenity-${amenity}`"
                        >
                            <UIcon
                                :name="GYM_AMENITIES[amenity]"
                                class="size-5 shrink-0 text-primary"
                            />
                            {{ $t(`gymInfo.amenities.${amenity}`) }}
                        </li>
                    </ul>
                </LayoutPanel>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { THUMBS, THUMB_SETS, thumbSrcset } from '#shared/utils/thumbs'
import { fileUrl } from '~/api/client'
import { GYM_AMENITIES } from '#shared/utils/gymAmenities'
import { GYM_CONTACT_KINDS } from '#shared/utils/gymContacts'
import { hasOpeningHours, toSchemaOrgHours } from '#shared/utils/openingHours'
import type { SettingsRecord } from '~/types/models'
import {
    contactLinks,
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
        ? fileUrl('gyms', gym.value, gym.value.cover_image, {
              thumb: THUMBS.cover,
          })
        : '',
)
const located = computed(() => hasLocation(gym.value))
const markers = computed(() =>
    gym.value
        ? gymMarkers([gym.value], (g) =>
              g.page_logo
                  ? fileUrl('gyms', g, g.page_logo, { thumb: THUMBS.logo })
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
const { data: settings } = useNuxtData<SettingsRecord>('settings')
const appEmail = computed(() => settings.value?.contact_email ?? '')

const infoDescription = computed(
    () =>
        gym.value?.description?.trim().slice(0, 160) ||
        t('seo.info', { name: title.value }),
)

useSeoMeta({
    title: () => t('page.title.info'),
    ogTitle: () => t('gymInfo.title', { name: title.value }),
    description: () => infoDescription.value,
    ogDescription: () => infoDescription.value,
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
