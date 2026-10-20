<template>
    <LayoutPanel id="settings-info" :title="$t('gymInfo.settings.title')">
        <div :class="SETTINGS_FIELDS_GRID">
            <UFormField
                :label="$t('gymInfo.settings.description')"
                name="description"
                :ui="SETTINGS_FIELD_UI"
                class="lg:col-span-2"
            >
                <UTextarea
                    v-model="form.description"
                    :maxlength="2000"
                    :rows="4"
                    autoresize
                    class="w-full"
                    data-testid="settings-info-description"
                />
            </UFormField>
            <UFormField
                :label="$t('gymInfo.settings.address')"
                name="address"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.address"
                    icon="i-lucide-map-pin"
                    :maxlength="300"
                    class="w-full"
                    :ui="{ trailing: 'pe-1' }"
                    data-testid="settings-info-address"
                    @keydown.enter.prevent="locateAddress"
                >
                    <template #trailing>
                        <UButton
                            icon="i-lucide-search"
                            color="neutral"
                            variant="link"
                            size="sm"
                            :label="$t('gymInfo.settings.locate')"
                            :loading="locating"
                            :disabled="!form.address.trim()"
                            data-testid="settings-info-locate"
                            @click="locateAddress"
                        />
                    </template>
                </UInput>
            </UFormField>
            <UFormField
                :label="$t('gymInfo.settings.website')"
                name="website_url"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.website_url"
                    type="url"
                    icon="i-lucide-globe"
                    placeholder="https://"
                    class="w-full"
                    data-testid="settings-info-website"
                />
            </UFormField>
            <UFormField
                :label="$t('gymInfo.location')"
                :ui="SETTINGS_FIELD_UI"
                class="lg:col-span-2"
            >
                <GymLocationMap
                    :markers="locationMarkers"
                    draggable
                    @update:position="movePin"
                />
            </UFormField>
            <UFormField
                :label="$t('gymInfo.hoursTitle')"
                name="opening_hours"
                :ui="SETTINGS_FIELD_UI"
            >
                <AdminOpeningHoursEditor v-model="form.opening_hours" />
            </UFormField>
            <UFormField
                :label="$t('gymInfo.settings.hoursNote')"
                name="hours_note"
                :ui="SETTINGS_FIELD_UI"
            >
                <UTextarea
                    v-model="form.hours_note"
                    :maxlength="300"
                    :rows="3"
                    autoresize
                    class="w-full"
                    data-testid="settings-info-hours-note"
                />
            </UFormField>
            <UFormField
                :label="$t('gymInfo.amenitiesTitle')"
                :ui="SETTINGS_FIELD_UI"
                class="lg:col-span-2"
            >
                <UCheckboxGroup
                    v-model="form.amenities"
                    :items="amenityItems"
                    :ui="{
                        fieldset:
                            'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
                    }"
                    data-testid="settings-info-amenities"
                />
            </UFormField>
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
import { translatedItems } from '~/utils/translatedItems'
import { GYM_AMENITY_KEYS } from '#shared/utils/gymAmenities'
import { geocodeAddress, hasLocation, reverseGeocode } from '~/utils/gymInfo'
import type { GymSettingsDraft } from '~/utils/gymSettingsDraft'
import { SETTINGS_FIELD_UI, SETTINGS_FIELDS_GRID } from '~/utils/settingsUi'

const props = defineProps<{ form: GymSettingsDraft }>()

const { t } = useI18n()

const amenityItems = computed(() =>
    translatedItems(GYM_AMENITY_KEYS, 'gymInfo.amenities', t),
)
const locationMarkers = computed(() =>
    hasLocation(props.form)
        ? [
              {
                  id: 'gym',
                  lat: props.form.latitude,
                  lng: props.form.longitude,
              },
          ]
        : [],
)

function setPosition([lat, lng]: [number, number]) {
    props.form.latitude = Number(lat.toFixed(6))
    props.form.longitude = Number(lng.toFixed(6))
}

async function movePin(position: [number, number]) {
    setPosition(position)
    const pinned = [props.form.latitude, props.form.longitude]
    const address = await reverseGeocode(position).catch(() => null)
    const stillPinned =
        props.form.latitude === pinned[0] && props.form.longitude === pinned[1]
    if (address && stillPinned) props.form.address = address
}

const { pending: locating, run: runLocate } = useAsyncAction()
function locateAddress() {
    if (!props.form.address.trim()) return
    return runLocate(
        async () => {
            const position = await geocodeAddress(props.form.address)
            if (!position) throw new Error('not found')
            setPosition(position)
        },
        { error: t('gymInfo.settings.notFound') },
    )
}
</script>
