<template>
    <UFormField
        :label="$t('settings.tv.screens')"
        :ui="fieldUi"
        class="lg:col-span-2"
    >
        <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl
                v-model="selectedId"
                :items="screenItems"
                size="md"
                test-id="settings-tv-screen"
            />
            <UButton
                v-if="model.screens.length < TV_MAX_SCREENS"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                :label="$t('settings.tv.addScreen')"
                data-testid="settings-tv-screen-add"
                @click="addScreen"
            />
        </div>
    </UFormField>

    <UFormField :label="$t('settings.tv.screenName')" :ui="fieldUi">
        <div class="flex items-center gap-2">
            <UInput
                v-model="screen.name"
                :maxlength="TV_MAX_SCREEN_NAME_LENGTH"
                :placeholder="screenLabel(selectedIndex)"
                class="w-full"
                data-testid="settings-tv-screen-name"
            />
            <UButton
                v-if="model.screens.length > 1"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('settings.tv.removeScreen')"
                data-testid="settings-tv-screen-remove"
                @click="removeScreen"
            />
        </div>
    </UFormField>

    <UFormField :label="$t('settings.tv.location')" :ui="fieldUi">
        <div class="flex flex-wrap items-center gap-4">
            <USelect
                v-model="location"
                :items="locationItems"
                class="min-w-48"
                data-testid="settings-tv-location"
            />
            <USwitch
                v-model="screen.takeover"
                :label="$t('settings.tv.takeover')"
                data-testid="settings-tv-takeover"
            />
        </div>
    </UFormField>

    <UFormField :label="$t('settings.tv.slidesTitle')" :ui="fieldUi">
        <div class="flex flex-col gap-3">
            <USwitch
                v-for="slide in TV_SLIDES"
                :key="slide"
                :model-value="screen.slides.includes(slide)"
                :label="$t(`settings.tv.slides.${slide}`)"
                :data-testid="`settings-tv-slide-${slide}`"
                @update:model-value="toggleSlide(slide, $event)"
            />
        </div>
    </UFormField>

    <UFormField :label="$t('settings.tv.seconds')" :ui="fieldUi">
        <div class="flex flex-wrap items-center gap-3">
            <SegmentedControl
                v-model="seconds"
                :items="secondItems"
                size="sm"
                test-id="settings-tv-seconds"
            />
            <UInputNumber
                :model-value="screen.seconds"
                :min="TV_MIN_SECONDS"
                :max="TV_MAX_SECONDS"
                class="w-32"
                :aria-label="$t('settings.tv.seconds')"
                data-testid="settings-tv-seconds-custom"
                @update:model-value="setSeconds"
            />
        </div>
    </UFormField>

    <UFormField
        :label="$t('settings.tv.screenLink')"
        :ui="fieldUi"
        class="lg:col-span-2"
    >
        <div class="flex flex-col gap-4 md:flex-row md:items-center">
            <img
                v-if="qr"
                :src="qr"
                :alt="$t('settings.tv.screenLink')"
                class="size-36 shrink-0 rounded-lg bg-white p-2 ring ring-default"
            />
            <div class="flex min-w-0 flex-1 flex-col gap-3">
                <code
                    class="rounded-md bg-elevated px-3 py-2 text-lg break-all"
                    data-testid="settings-tv-url"
                    >{{ screenUrl }}</code
                >
                <div class="flex flex-wrap gap-2">
                    <UButton
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="outline"
                        :label="$t('settings.tv.copy')"
                        data-testid="settings-tv-copy"
                        @click="copy"
                    />
                    <UButton
                        icon="i-lucide-external-link"
                        color="neutral"
                        variant="outline"
                        :label="$t('settings.tv.open')"
                        :to="screenUrl"
                        target="_blank"
                        external
                        data-testid="settings-tv-open"
                    />
                </div>
            </div>
        </div>
    </UFormField>

    <UFormField
        :label="$t('settings.tv.announcements')"
        name="tv_settings"
        :ui="fieldUi"
        class="lg:col-span-2"
    >
        <div class="flex flex-col gap-3">
            <div
                v-for="(announcement, index) in model.announcements"
                :key="index"
                class="flex flex-col gap-2 sm:flex-row sm:items-start"
                :data-testid="`settings-tv-announcement-${index}`"
            >
                <UTextarea
                    v-model="announcement.text"
                    :maxlength="TV_MAX_ANNOUNCEMENT_LENGTH"
                    :rows="1"
                    autoresize
                    class="w-full sm:flex-1"
                    :aria-label="$t('settings.tv.announcementText')"
                    data-testid="settings-tv-announcement-text"
                />
                <div class="flex items-center gap-2">
                    <UInput
                        v-model="announcement.until"
                        type="date"
                        :aria-label="$t('settings.tv.until')"
                        data-testid="settings-tv-announcement-until"
                    >
                        <template #leading>
                            <span class="text-sm text-muted">{{
                                $t('settings.tv.until')
                            }}</span>
                        </template>
                    </UInput>
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        class="icon-btn"
                        :aria-label="$t('settings.tv.removeAnnouncement')"
                        data-testid="settings-tv-announcement-remove"
                        @click="model.announcements.splice(index, 1)"
                    />
                </div>
            </div>
            <UButton
                v-if="model.announcements.length < TV_MAX_ANNOUNCEMENTS"
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                class="self-start"
                :label="$t('settings.tv.addAnnouncement')"
                data-testid="settings-tv-announcement-add"
                @click="model.announcements.push({ text: '', until: '' })"
            />
        </div>
    </UFormField>
</template>

<script setup lang="ts">
import { listLocations } from '~/api/routes'
import type { GymRecord } from '~/types/models'
import { copyText } from '~/utils/clipboard'
import { qrDataUrl } from '~/utils/qrDataUrl'
import { SETTINGS_FIELD_UI } from '~/utils/settingsUi'
import { knownLocation, newTvScreenId, tvScreenUrl } from '~/utils/tvScreen'
import {
    TV_MAX_ANNOUNCEMENTS,
    TV_MAX_ANNOUNCEMENT_LENGTH,
    TV_MAX_SCREENS,
    TV_MAX_SCREEN_NAME_LENGTH,
    TV_MAX_SECONDS,
    TV_MIN_SECONDS,
    TV_SECONDS_PRESETS,
    TV_SLIDES,
    defaultTvScreen,
    type ResolvedTvSettings,
    type TvSlide,
} from '#shared/utils/tvSettings'

const ALL_LOCATIONS = 'all'

const props = defineProps<{ gym: GymRecord | null | undefined }>()
const model = defineModel<ResolvedTvSettings>({ required: true })

const { t } = useI18n()
const { success: notifySuccess, error: notifyError } = useNotification()
const fieldUi = SETTINGS_FIELD_UI
const requestUrl = useRequestURL({
    xForwardedHost: true,
    xForwardedProto: true,
})

const selectedId = ref(model.value.screens[0]!.id)
const selectedIndex = computed(() =>
    Math.max(
        model.value.screens.findIndex((entry) => entry.id === selectedId.value),
        0,
    ),
)
const screen = computed(() => model.value.screens[selectedIndex.value]!)
watch(
    () => model.value.screens.map((entry) => entry.id),
    (ids) => {
        if (!ids.includes(selectedId.value)) selectedId.value = ids[0]!
    },
)
const screenLabel = (index: number) =>
    t('settings.tv.screenNumber', { n: index + 1 })
const screenItems = computed(() =>
    model.value.screens.map((entry, index) => ({
        value: entry.id,
        label: entry.name.trim() || screenLabel(index),
        testId: `settings-tv-screen-${index}`,
    })),
)

function addScreen() {
    const added = defaultTvScreen(newTvScreenId())
    model.value.screens.push(added)
    selectedId.value = added.id
}

function removeScreen() {
    model.value.screens.splice(selectedIndex.value, 1)
    selectedId.value = model.value.screens[0]!.id
}

function toggleSlide(slide: TvSlide, on: boolean) {
    const enabled = new Set(screen.value.slides)
    if (on) enabled.add(slide)
    else enabled.delete(slide)
    screen.value.slides = TV_SLIDES.filter((entry) => enabled.has(entry))
}

function setSeconds(value: number | null | undefined) {
    if (Number.isInteger(value)) screen.value.seconds = value!
}
const seconds = computed({
    get: () => String(screen.value.seconds),
    set: (value: string) => setSeconds(Number(value)),
})
const secondItems = TV_SECONDS_PRESETS.map((value) => ({
    value: String(value),
    label: t('settings.tv.secondsValue', { n: value }),
}))

const { data: locations } = useAsyncData(
    () => `tv-settings-locations:${props.gym?.id ?? ''}`,
    () => listLocations(props.gym!.id),
    { default: () => [], enabled: () => !!props.gym?.id },
)
const location = computed({
    get: () =>
        knownLocation(screen.value.location, locations.value) || ALL_LOCATIONS,
    set: (value: string) =>
        (screen.value.location = value === ALL_LOCATIONS ? '' : value),
})
const locationItems = computed(() => [
    { label: t('settings.tv.allLocations'), value: ALL_LOCATIONS },
    ...locations.value.map((entry) => ({
        label: entry.name,
        value: entry.id,
    })),
])

const screenUrl = computed(() =>
    tvScreenUrl(requestUrl.origin, props.gym?.slug ?? '', screen.value.id),
)
const qr = ref('')
watch(
    screenUrl,
    async (url) => {
        if (import.meta.client) qr.value = await qrDataUrl(url)
    },
    { immediate: true },
)

async function copy() {
    if (await copyText(screenUrl.value)) notifySuccess(t('settings.tv.copied'))
    else notifyError(t('notifications.error.generic'))
}
</script>
