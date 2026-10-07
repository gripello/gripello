<template>
    <SettingsLayout
        v-slot="{ activeSection }"
        :sections="sections"
        :has-changes="hasChanges"
        :saving="saving"
        test-id-prefix="settings"
        @save="settingsForm?.submit()"
        @cancel="resetForm"
    >
        <UForm
            ref="settingsForm"
            :state="copySettings"
            :validate="validateSettings"
            class="flex flex-col gap-6 empty:hidden"
            @submit="saveSettings"
        >
            <UPageCard
                v-if="activeSection === 'branding'"
                id="settings-branding"
                :title="$t('settings.branding')"
                :description="$t('settings.brandingHint')"
                variant="subtle"
            >
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <article
                        v-for="asset in assetFields"
                        :key="asset.key"
                        class="asset-card"
                        :class="{ 'asset-card--dirty': asset.isDirty }"
                    >
                        <button
                            type="button"
                            class="asset-card__preview"
                            :class="{
                                'asset-card__preview--empty':
                                    !asset.preview.value,
                            }"
                            :data-testid="`settings-asset-${asset.key}`"
                            :aria-label="`${asset.label}: ${asset.preview.value ? $t('settings.replace') : $t('settings.clickToUpload')}`"
                            @click="asset.triggerInput()"
                        >
                            <img
                                v-if="asset.preview.value"
                                :src="asset.preview.value"
                                :alt="asset.label"
                                class="asset-card__image"
                                :class="{
                                    'asset-card__image--mono':
                                        asset.key === 'logo',
                                }"
                            />
                            <span
                                v-else
                                class="flex flex-col items-center gap-2 text-sm text-muted"
                            >
                                <UIcon
                                    name="i-lucide-image-plus"
                                    class="size-8"
                                />
                                {{ $t('settings.clickToUpload') }}
                            </span>
                        </button>

                        <div class="flex flex-1 flex-col gap-1 p-4">
                            <div class="flex items-center gap-2">
                                <span
                                    class="font-semibold text-highlighted"
                                    :data-testid="`settings-asset-label-${asset.key}`"
                                    >{{ asset.label }}</span
                                >
                                <UBadge
                                    v-if="asset.isDirty"
                                    color="warning"
                                    size="sm"
                                    variant="soft"
                                >
                                    {{ $t('settings.changed') }}
                                </UBadge>
                            </div>
                            <p class="text-sm text-muted">
                                {{ asset.hint }}
                            </p>

                            <div
                                class="mt-auto flex flex-wrap items-center gap-2 pt-3"
                            >
                                <div
                                    v-if="asset.preview.value"
                                    class="flex flex-wrap gap-2"
                                    :data-testid="`settings-asset-actions-${asset.key}`"
                                >
                                    <UButton
                                        color="neutral"
                                        variant="outline"
                                        size="sm"
                                        icon="i-lucide-image-up"
                                        :data-testid="`settings-asset-replace-${asset.key}`"
                                        @click="asset.triggerInput()"
                                    >
                                        {{ $t('settings.replace') }}
                                    </UButton>
                                    <UButton
                                        v-if="!asset.isDirty"
                                        color="error"
                                        variant="ghost"
                                        size="sm"
                                        icon="i-lucide-trash-2"
                                        :data-testid="`settings-asset-delete-${asset.key}`"
                                        @click="asset.onDelete()"
                                    >
                                        {{ $t('settings.removeImage') }}
                                    </UButton>
                                </div>
                                <UButton
                                    v-else
                                    color="neutral"
                                    variant="outline"
                                    size="sm"
                                    icon="i-lucide-upload"
                                    @click="asset.triggerInput()"
                                >
                                    {{ $t('settings.clickToUpload') }}
                                </UButton>
                                <UButton
                                    v-if="asset.isDirty"
                                    color="neutral"
                                    variant="ghost"
                                    size="sm"
                                    icon="i-lucide-undo-2"
                                    @click="asset.onRevert()"
                                >
                                    {{ $t('settings.revertChange') }}
                                </UButton>
                            </div>
                        </div>

                        <input
                            :ref="
                                (el) => {
                                    asset.inputRef.value =
                                        el as HTMLInputElement | null
                                }
                            "
                            type="file"
                            :accept="asset.accept"
                            class="hidden"
                            @change="onFileChange($event, asset.onSelect)"
                        />
                    </article>
                </div>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'organization'"
                id="settings-organization"
                :ui="formCardUi"
                :title="$t('settings.organization')"
                :description="$t('settings.organizationHint')"
                variant="subtle"
            >
                <UFormField
                    :label="$t('settings.organizationName')"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.name"
                        icon="i-lucide-building-2"
                        :placeholder="
                            $t('settings.organizationNamePlaceholder')
                        "
                        :maxlength="50"
                        class="w-full"
                        data-testid="settings-org-name"
                    />
                </UFormField>
                <UFormField
                    :label="$t('settings.organizationUnit')"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.unit_name"
                        icon="i-lucide-building-2"
                        :placeholder="
                            $t('settings.organizationUnitPlaceholder')
                        "
                        :maxlength="50"
                        class="w-full"
                        data-testid="settings-org-unit"
                    />
                </UFormField>
                <template v-if="editSlug">
                    <UFormField
                        :label="$t('platform.gyms.slug')"
                        name="slug"
                        :ui="fieldUi"
                    >
                        <UInput
                            v-model="copySettings.slug"
                            icon="i-lucide-link"
                            class="w-full"
                            :ui="{ base: 'font-mono' }"
                            data-testid="platform-gym-slug"
                        />
                    </UFormField>
                    <UFormField
                        v-if="copySettings.previous_slugs.length"
                        :label="$t('platform.gyms.previousSlugs')"
                        :ui="fieldUi"
                    >
                        <div class="flex flex-wrap gap-2">
                            <UBadge
                                v-for="previous in copySettings.previous_slugs"
                                :key="previous"
                                color="neutral"
                                variant="soft"
                                size="lg"
                                class="font-mono"
                                :data-testid="`platform-gym-previous-${previous}`"
                            >
                                /{{ previous }}
                                <UButton
                                    icon="i-lucide-x"
                                    color="neutral"
                                    variant="link"
                                    size="xs"
                                    :aria-label="`${$t('actions.delete')} ${previous}`"
                                    :data-testid="`platform-gym-release-${previous}`"
                                    @click="releaseSlug(previous)"
                                />
                            </UBadge>
                        </div>
                    </UFormField>
                </template>
                <UFormField
                    :label="$t('settings.contactEmail')"
                    :help="$t('settings.contactEmailHint')"
                    name="contact_email"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.contact_email"
                        type="email"
                        icon="i-lucide-mail"
                        class="w-full"
                        data-testid="settings-contact-email"
                    />
                </UFormField>
                <UFormField
                    :label="$t('settings.defaultLanguage')"
                    :help="$t('settings.defaultLanguageHelp')"
                    name="language"
                    :ui="fieldUi"
                >
                    <USelect
                        v-model="copySettings.language"
                        :items="languageItems"
                        icon="i-lucide-languages"
                        class="w-full"
                        data-testid="settings-mail-language"
                    />
                </UFormField>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'info'"
                id="settings-info"
                :ui="formCardUi"
                :title="$t('gymInfo.settings.title')"
                variant="subtle"
            >
                <UFormField
                    :label="$t('gymInfo.settings.description')"
                    name="description"
                    :ui="fieldUi"
                    class="lg:col-span-2"
                >
                    <UTextarea
                        v-model="copySettings.description"
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
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.address"
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
                                :disabled="!copySettings.address.trim()"
                                data-testid="settings-info-locate"
                                @click="locateAddress"
                            />
                        </template>
                    </UInput>
                </UFormField>
                <UFormField
                    :label="$t('gymInfo.settings.website')"
                    name="website_url"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.website_url"
                        type="url"
                        icon="i-lucide-globe"
                        placeholder="https://"
                        class="w-full"
                        data-testid="settings-info-website"
                    />
                </UFormField>
                <UFormField
                    :label="$t('gymInfo.location')"
                    :ui="fieldUi"
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
                    :ui="fieldUi"
                >
                    <AdminOpeningHoursEditor
                        v-model="copySettings.opening_hours"
                    />
                </UFormField>
                <UFormField
                    :label="$t('gymInfo.settings.hoursNote')"
                    name="hours_note"
                    :ui="fieldUi"
                >
                    <UTextarea
                        v-model="copySettings.hours_note"
                        :maxlength="300"
                        :rows="3"
                        autoresize
                        class="w-full"
                        data-testid="settings-info-hours-note"
                    />
                </UFormField>
                <UFormField
                    :label="$t('gymInfo.amenitiesTitle')"
                    :ui="fieldUi"
                    class="lg:col-span-2"
                >
                    <UCheckboxGroup
                        v-model="copySettings.amenities"
                        :items="amenityItems"
                        :ui="{
                            fieldset:
                                'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
                        }"
                        data-testid="settings-info-amenities"
                    />
                </UFormField>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'moderation'"
                id="settings-moderation"
                :title="$t('moderation.title')"
                variant="subtle"
                :ui="formCardUi"
            >
                <UFormField
                    :label="$t('settings.premoderateBetas')"
                    name="premoderate_betas"
                    :ui="fieldUi"
                >
                    <USwitch
                        v-model="copySettings.premoderate_betas"
                        data-testid="settings-premoderate-betas"
                    />
                </UFormField>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'grading'"
                id="settings-grading"
                :title="$t('settings.grading')"
                :description="$t('settings.gradingHint')"
                variant="subtle"
                :ui="{ ...formCardUi, footer: 'pt-2 lg:col-span-2' }"
            >
                <template #footer>
                    <GradeConversionDialog />
                </template>
                <UFormField
                    :label="$t('settings.routeGradeSystem')"
                    :ui="fieldUi"
                >
                    <USelect
                        v-model="copySettings.route_grade_system"
                        :items="gradeSystemItems(ROUTE_GRADE_SYSTEMS)"
                        icon="i-lucide-trending-up"
                        class="w-full"
                        data-testid="settings-route-grade-system"
                    />
                </UFormField>
                <UFormField
                    :label="$t('settings.boulderGradeSystem')"
                    :ui="fieldUi"
                >
                    <USelect
                        v-model="copySettings.boulder_grade_system"
                        :items="gradeSystemItems(BOULDER_GRADE_SYSTEMS)"
                        icon="i-lucide-box"
                        class="w-full"
                        data-testid="settings-boulder-grade-system"
                    />
                </UFormField>
                <UFormField
                    :label="$t('settings.boulderBands')"
                    :help="$t('settings.boulderBandsHint')"
                    :ui="fieldUi"
                    class="lg:col-span-2"
                >
                    <AdminBoulderBandEditor
                        v-model="copySettings.boulder_bands"
                    />
                    <div class="mt-3 flex flex-wrap gap-2">
                        <UButton
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            icon="i-lucide-rotate-ccw"
                            data-testid="settings-boulder-band-reset"
                            @click="
                                copySettings.boulder_bands =
                                    defaultBandSettings()
                            "
                        >
                            {{ $t('settings.resetBands') }}
                        </UButton>
                    </div>
                </UFormField>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'urls'"
                id="settings-urls"
                :ui="formCardUi"
                :title="$t('settings.publicUrls')"
                :description="$t('settings.publicUrlsHint')"
                variant="subtle"
            >
                <UFormField
                    :label="$t('settings.imprintUrl')"
                    :help="$t('settings.legalUrlHint')"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.imprint_url"
                        icon="i-lucide-file-text"
                        placeholder="https://example.com/imprint"
                        class="w-full"
                        data-testid="settings-imprint-url"
                    />
                </UFormField>
                <UFormField
                    :label="$t('settings.privacyUrl')"
                    :help="$t('settings.legalUrlHint')"
                    :ui="fieldUi"
                >
                    <UInput
                        v-model="copySettings.privacy_url"
                        icon="i-lucide-shield"
                        placeholder="https://example.com/privacy"
                        class="w-full"
                        data-testid="settings-privacy-url"
                    />
                </UFormField>
            </UPageCard>

            <UPageCard
                v-if="activeSection === 'legal'"
                id="settings-legal"
                :ui="formCardUi"
                :title="$t('settings.legalTitle')"
                :description="$t('settings.legalIntro')"
                variant="subtle"
            >
                <SettingsLegalFields :legal="copySettings" />
            </UPageCard>
        </UForm>

        <template v-for="section in extraSections" :key="section.id">
            <slot v-if="activeSection === section.id" :name="section.id" />
        </template>
    </SettingsLayout>
</template>

<script setup lang="ts">
import { hasFeature } from '#shared/utils/featureFlags'
import { GYM_AMENITY_KEYS, type GymAmenity } from '#shared/utils/gymAmenities'
import {
    HOURS_DAYS,
    isValidOpeningHours,
    type GymOpeningHours,
} from '#shared/utils/openingHours'
import { geocodeAddress, hasLocation, reverseGeocode } from '~/utils/gymInfo'
import type { Form } from '@nuxt/ui'
import type { GymRecord } from '~/types/models'
import { isValidGymSlug } from '#shared/utils/gymSlug'
import { required, validEmail, validateRules } from '~/utils/validation'
import { SETTINGS_CARD_UI, SETTINGS_FIELD_UI } from '~/utils/settingsUi'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '~/utils/locales'
import {
    DEFAULT_GYM_BANDS,
    bandSettingsFrom,
    type BoulderBandSetting,
} from '#shared/utils/gradeReference'
import {
    BOULDER_GRADE_SYSTEMS,
    DEFAULT_BOULDER_GRADE_SYSTEM,
    DEFAULT_ROUTE_GRADE_SYSTEM,
    ROUTE_GRADE_SYSTEMS,
    type GradeSystem,
} from '#shared/utils/grades'

type FileInputRef = HTMLInputElement | null

const props = withDefaults(
    defineProps<{
        gym: GymRecord | null | undefined
        editSlug?: boolean
        extraSections?: {
            id: string
            label: string
            icon: string
            after?: string
        }[]
    }>(),
    { extraSections: () => [] },
)
const emit = defineEmits<{ saved: [gym: GymRecord] }>()

const pb = usePocketbase()
const { t } = useI18n()
const settings = computed(() => props.gym)

const original = reactive({
    imprint_url: '',
    privacy_url: '',
    name: '',
    unit_name: '',
    contact_email: '',
    language: DEFAULT_LOCALE as string,
    slug: '',
    previous_slugs: [] as string[],
    route_grade_system: DEFAULT_ROUTE_GRADE_SYSTEM as string,
    boulder_grade_system: DEFAULT_BOULDER_GRADE_SYSTEM as string,
    premoderate_betas: false,
    description: '',
    address: '',
    latitude: 0,
    longitude: 0,
    website_url: '',
    opening_hours: hoursFrom(null),
    hours_note: '',
    amenities: [] as GymAmenity[],
    ...legalFieldsFrom({}),
    ...bandFieldsFrom({}),
})

const languageItems = SUPPORTED_LOCALES.map(({ code, name }) => ({
    label: name,
    value: code as string,
}))

function gradeSystemItems(systems: GradeSystem[]) {
    return systems.map((value) => ({
        label: t(`gradeSystems.${value}`),
        value: value as string,
    }))
}

function hoursFrom(hours: GymOpeningHours | null | undefined) {
    return Object.fromEntries(
        HOURS_DAYS.map((day) => [
            day,
            (hours?.[day] ?? []).map((interval) => [...interval]),
        ]),
    ) as GymOpeningHours
}

function freshCopy() {
    return {
        ...original,
        previous_slugs: [...original.previous_slugs],
        opening_hours: hoursFrom(original.opening_hours),
        amenities: [...original.amenities],
        ...legalFieldsFrom(original),
        ...bandFieldsFrom(original),
    }
}

const copySettings = reactive(freshCopy())
const settingsForm = ref<Form<typeof copySettings> | null>(null)

function validateSettings(state: typeof copySettings) {
    return validateRules(state, {
        contact_email: [(email) => !email || validEmail(t)(email)],
        opening_hours: [
            (hours) =>
                isValidOpeningHours(hours) ||
                t('gymInfo.settings.invalidHours'),
        ],
        ...(props.editSlug && {
            slug: [
                required(t),
                (slug) =>
                    isValidGymSlug(String(slug)) ||
                    t('platform.gyms.invalidSlug'),
            ],
        }),
    })
}

function releaseSlug(slug: string) {
    copySettings.previous_slugs = copySettings.previous_slugs.filter(
        (entry) => entry !== slug,
    )
}

function defaultBandSettings(): BoulderBandSetting[] {
    return bandSettingsFrom(DEFAULT_GYM_BANDS, (band) =>
        t(`gradeConversion.bands.${band.key}`),
    )
}

function bandFieldsFrom(rec: Partial<GymRecord>) {
    return {
        boulder_bands: rec.boulder_bands?.length
            ? rec.boulder_bands.map((band) => ({ ...band }))
            : defaultBandSettings(),
    }
}

type EditableSettings = typeof original
type EditableField = keyof EditableSettings

function sameValue(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function untouchedFields() {
    return (Object.keys(original) as EditableField[]).filter((field) =>
        sameValue(copySettings[field], original[field]),
    )
}

function fieldsPayload(state: EditableSettings) {
    return {
        imprint_url: state.imprint_url,
        privacy_url: state.privacy_url,
        name: state.name,
        unit_name: state.unit_name,
        contact_email: state.contact_email,
        language: state.language,
        slug: state.slug,
        previous_slugs: state.previous_slugs,
        route_grade_system: state.route_grade_system,
        boulder_grade_system: state.boulder_grade_system,
        premoderate_betas: state.premoderate_betas,
        description: state.description,
        address: state.address,
        latitude: state.latitude,
        longitude: state.longitude,
        website_url: state.website_url,
        opening_hours: state.opening_hours,
        hours_note: state.hours_note,
        amenities: state.amenities,
        ...legalPayload(state),
        boulder_bands: state.boulder_bands.map((band) => ({
            ...band,
            name: band.name.trim(),
        })),
    }
}

function changedFieldsPayload(): Record<string, unknown> {
    const baseline: Record<string, unknown> = fieldsPayload(original)
    return Object.fromEntries(
        Object.entries(fieldsPayload(copySettings)).filter(
            ([field, value]) => !sameValue(value, baseline[field]),
        ),
    )
}

function adoptOriginal(rec: GymRecord) {
    original.imprint_url = rec.imprint_url ?? ''
    original.privacy_url = rec.privacy_url ?? ''
    original.name = rec.name ?? ''
    original.unit_name = rec.unit_name ?? ''
    original.contact_email = rec.contact_email ?? ''
    original.language = rec.language || DEFAULT_LOCALE
    original.slug = rec.slug ?? ''
    original.previous_slugs = [...(rec.previous_slugs ?? [])]
    original.route_grade_system =
        rec.route_grade_system || DEFAULT_ROUTE_GRADE_SYSTEM
    original.boulder_grade_system =
        rec.boulder_grade_system || DEFAULT_BOULDER_GRADE_SYSTEM
    original.premoderate_betas = !!rec.premoderate_betas
    original.description = rec.description ?? ''
    original.address = rec.address ?? ''
    original.latitude = rec.latitude ?? 0
    original.longitude = rec.longitude ?? 0
    original.website_url = rec.website_url ?? ''
    original.opening_hours = hoursFrom(rec.opening_hours)
    original.hours_note = rec.hours_note ?? ''
    original.amenities = [...(rec.amenities ?? [])]
    Object.assign(original, legalFieldsFrom(rec), bandFieldsFrom(rec))
}

function adoptRecord(rec: GymRecord | null | undefined) {
    if (!rec) return
    const untouched = untouchedFields()
    adoptOriginal(rec)
    const fresh = freshCopy()
    for (const field of untouched) {
        Object.assign(copySettings, { [field]: fresh[field] })
    }

    for (const asset of assets) asset.preview.value = asset.stored(rec)
}

const { pending: saving, run: runSave } = useAsyncAction()

function pbFileUrl(
    rec: Partial<GymRecord> | null | undefined,
    filename: string | null | undefined,
) {
    return usePbFileUrl(rec, filename) || null
}

function onFileChange(event: Event, onSelect: (file: File | null) => void) {
    const input = event.target as HTMLInputElement
    onSelect(input.files?.[0] ?? null)
    input.value = ''
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/svg+xml,image/webp'

function assetSlot(
    key: string,
    field: 'page_logo' | 'page_icon' | 'sign_image' | 'cover_image',
    accept: string,
) {
    const file = ref<File | null>(null)
    const clear = ref(false)
    const inputRef = ref<FileInputRef>(null)
    const preview = ref<string | null>(null)
    const stored = (rec: Partial<GymRecord> | null | undefined) =>
        pbFileUrl(rec, rec?.[field])
    return {
        key,
        field,
        accept,
        file,
        clear,
        inputRef,
        preview,
        stored,
        reset(rec = settings.value) {
            file.value = null
            clear.value = false
            preview.value = stored(rec)
        },
        select(selected: File | null) {
            file.value = selected
            clear.value = false
            preview.value = selected
                ? URL.createObjectURL(selected)
                : stored(settings.value)
        },
        remove() {
            clear.value = true
            preview.value = null
        },
    }
}

const assets = [
    assetSlot('logo', 'page_logo', IMAGE_ACCEPT),
    assetSlot(
        'icon',
        'page_icon',
        '.ico,image/vnd.microsoft.icon,image/x-icon',
    ),
    assetSlot('sign', 'sign_image', IMAGE_ACCEPT),
    assetSlot('cover', 'cover_image', 'image/jpeg,image/png,image/webp'),
]

const assetFields = computed(() =>
    assets.map((asset) => ({
        key: asset.key,
        label: t(`settings.assets.${asset.key}`),
        hint: t(`settings.assetHints.${asset.key}`),
        accept: asset.accept,
        preview: asset.preview,
        inputRef: asset.inputRef,
        isDirty: !!asset.file.value || asset.clear.value,
        onSelect: asset.select,
        onRevert: () => asset.reset(),
        onDelete: asset.remove,
        triggerInput: () => asset.inputRef.value?.click(),
    })),
)

const fieldUi = SETTINGS_FIELD_UI

const amenityItems = computed(() =>
    GYM_AMENITY_KEYS.map((value) => ({
        value,
        label: t(`gymInfo.amenities.${value}`),
    })),
)
const locationMarkers = computed(() =>
    hasLocation(copySettings)
        ? [
              {
                  id: 'gym',
                  lat: copySettings.latitude,
                  lng: copySettings.longitude,
              },
          ]
        : [],
)

function setPosition([lat, lng]: [number, number]) {
    copySettings.latitude = Number(lat.toFixed(6))
    copySettings.longitude = Number(lng.toFixed(6))
}

async function movePin(position: [number, number]) {
    setPosition(position)
    const pinned = [copySettings.latitude, copySettings.longitude]
    const address = await reverseGeocode(position).catch(() => null)
    const stillPinned =
        copySettings.latitude === pinned[0] &&
        copySettings.longitude === pinned[1]
    if (address && stillPinned) copySettings.address = address
}

const { pending: locating, run: runLocate } = useAsyncAction()
function locateAddress() {
    if (!copySettings.address.trim()) return
    return runLocate(
        async () => {
            const position = await geocodeAddress(copySettings.address)
            if (!position) throw new Error('not found')
            setPosition(position)
        },
        { error: t('gymInfo.settings.notFound') },
    )
}
const formCardUi = SETTINGS_CARD_UI

const formSections = computed(() => [
    {
        id: 'branding',
        label: t('settings.branding'),
        icon: 'i-lucide-image',
    },
    {
        id: 'organization',
        label: t('settings.organization'),
        icon: 'i-lucide-building-2',
    },
    {
        id: 'info',
        label: t('gymInfo.settings.title'),
        icon: 'i-lucide-info',
    },
    {
        id: 'grading',
        label: t('settings.grading'),
        icon: 'i-lucide-trending-up',
    },
    ...(hasFeature(settings.value, 'beta_videos')
        ? [
              {
                  id: 'moderation',
                  label: t('moderation.title'),
                  icon: 'i-lucide-shield-check',
              },
          ]
        : []),
    {
        id: 'urls',
        label: t('settings.publicUrls'),
        icon: 'i-lucide-globe',
    },
    {
        id: 'legal',
        label: t('settings.legalTitle'),
        icon: 'i-lucide-scale',
    },
])

const sections = computed(() =>
    props.extraSections.reduce(
        (list, extra) => {
            const index = list.findIndex(
                (section) => section.id === extra.after,
            )
            list.splice(index < 0 ? list.length : index + 1, 0, extra)
            return list
        },
        [...formSections.value],
    ),
)

const hasChanges = computed(
    () =>
        assets.some((asset) => asset.file.value || asset.clear.value) ||
        Object.keys(changedFieldsPayload()).length > 0,
)

function resetForm() {
    for (const asset of assets) asset.reset()
    Object.assign(copySettings, freshCopy())
}

watch(settings, adoptRecord, { immediate: true })

async function saveSettings() {
    if (!hasChanges.value || saving.value) return
    await runSave(
        async () => {
            const payload = changedFieldsPayload()
            for (const asset of assets) {
                if (asset.file.value) payload[asset.field] = asset.file.value
                else if (asset.clear.value) payload[asset.field] = null
            }

            const updated = await pb
                .collection('gyms')
                .update<GymRecord>(settings.value!.id, payload)

            for (const asset of assets) asset.reset(updated)

            adoptOriginal(updated)
            Object.assign(copySettings, freshCopy())
            emit('saved', updated)
        },
        {
            success: t('settings.saveSuccess'),
            error: t('settings.saveError'),
        },
    )
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.asset-card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * 2);
    background: var(--ui-bg);
    transition: border-color 0.18s;
}

.asset-card--dirty {
    border-color: var(--ui-primary);
}

.asset-card__preview {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 160px;
    padding: 24px;
    border-bottom: 1px solid var(--ui-border);
    background-color: #f4f4f5;
    background-image:
        linear-gradient(45deg, #e4e4e7 25%, transparent 25%),
        linear-gradient(-45deg, #e4e4e7 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #e4e4e7 75%),
        linear-gradient(-45deg, transparent 75%, #e4e4e7 75%);
    background-size: 16px 16px;
    background-position:
        0 0,
        0 8px,
        8px -8px,
        -8px 0;
    cursor: pointer;
}

.asset-card__preview--empty {
    background: var(--ui-bg-muted);
    border-bottom-style: dashed;
}

.asset-card__preview:hover,
.asset-card__preview:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

.asset-card__image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.asset-card__image--mono {
    filter: brightness(0);
}
</style>
