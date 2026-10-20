<template>
    <SettingsLayout
        v-slot="{ activeSection }"
        drill-down
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
            <AdminSettingsBrandingSection
                v-if="activeSection === 'branding'"
                :assets="assetFields"
            />

            <AdminSettingsOrganizationSection
                v-if="activeSection === 'organization'"
                :form="copySettings"
                :edit-slug="editSlug"
            />

            <AdminSettingsInfoSection
                v-if="activeSection === 'info'"
                :form="copySettings"
            />

            <LayoutPanel
                v-if="activeSection === 'tv'"
                id="settings-tv"
                :title="$t('settings.tv.title')"
            >
                <div :class="SETTINGS_FIELDS_GRID">
                    <AdminTvSettings
                        v-model="copySettings.tv_settings"
                        :gym="settings"
                    />
                </div>
            </LayoutPanel>

            <LayoutPanel
                v-if="activeSection === 'moderation'"
                id="settings-moderation"
                :title="$t('moderation.title')"
            >
                <div :class="SETTINGS_FIELDS_GRID">
                    <UFormField
                        :label="$t('settings.premoderateBetas')"
                        name="premoderate_betas"
                        :ui="SETTINGS_FIELD_UI"
                    >
                        <USwitch
                            v-model="copySettings.premoderate_betas"
                            data-testid="settings-premoderate-betas"
                        />
                    </UFormField>
                </div>
            </LayoutPanel>

            <AdminSettingsGradingSection
                v-if="activeSection === 'grading'"
                :form="copySettings"
                @reset-bands="
                    copySettings.boulder_bands = defaultBandSettings()
                "
            />

            <LayoutPanel
                v-if="activeSection === 'urls'"
                id="settings-urls"
                :title="$t('settings.publicUrls')"
            >
                <div :class="SETTINGS_FIELDS_GRID">
                    <UFormField
                        :label="$t('settings.imprintUrl')"
                        :help="$t('settings.legalUrlHint')"
                        :ui="SETTINGS_FIELD_UI"
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
                        :ui="SETTINGS_FIELD_UI"
                    >
                        <UInput
                            v-model="copySettings.privacy_url"
                            icon="i-lucide-shield"
                            placeholder="https://example.com/privacy"
                            class="w-full"
                            data-testid="settings-privacy-url"
                        />
                    </UFormField>
                </div>
            </LayoutPanel>

            <LayoutPanel
                v-if="activeSection === 'legal'"
                id="settings-legal"
                :title="$t('settings.legalTitle')"
            >
                <div :class="SETTINGS_FIELDS_GRID">
                    <SettingsLegalFields :legal="copySettings" />
                </div>
            </LayoutPanel>
            <LayoutPanel
                v-if="activeSection === 'privacy'"
                id="settings-privacy"
                :title="$t('settings.privacy.title')"
            >
                <div :class="SETTINGS_FIELDS_GRID">
                    <UFormField
                        name="privacy_doc"
                        class="w-full min-w-0 lg:col-span-2"
                    >
                        <LazySettingsPrivacyEditor
                            v-model:doc="copySettings.privacy_doc"
                            :controller="copySettings"
                            :imprint-path="gymLink('/imprint', original.slug)"
                        />
                    </UFormField>
                </div>
            </LayoutPanel>
        </UForm>

        <template v-for="section in extraSections" :key="section.id">
            <slot v-if="activeSection === section.id" :name="section.id" />
        </template>
    </SettingsLayout>
</template>

<script setup lang="ts">
import { useObjectUrl } from '@vueuse/core'
import { fileUrl } from '~/api/client'
import { updateGym, type GymFiles, type GymInput } from '~/api/gyms'
import { hasFeature } from '#shared/utils/featureFlags'
import {
    isValidTvSettings,
    type ResolvedTvSettings,
} from '#shared/utils/tvSettings'
import { tvSettingsPayload } from '~/utils/tvScreen'
import { isValidOpeningHours } from '#shared/utils/openingHours'
import type { Form } from '@nuxt/ui'
import type { GymRecord } from '~/types/models'
import { isValidGymSlug } from '#shared/utils/gymSlug'
import { type RichTextDoc } from '#shared/utils/privacyDoc'
import { gymLink } from '~/utils/navigation'
import { privacyDocProblem } from '~/utils/privacyEditor'
import { required, validEmail, validateRules } from '~/utils/validation'
import { SETTINGS_FIELD_UI, SETTINGS_FIELDS_GRID } from '~/utils/settingsUi'
import { changedGymSettings, gymSettingsDraft } from '~/utils/gymSettingsDraft'
import {
    DEFAULT_GYM_BANDS,
    bandSettingsFrom,
    type BoulderBandSetting,
} from '#shared/utils/gradeReference'

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

const { t } = useI18n()
const settings = computed(() => props.gym)

function defaultBandSettings(): BoulderBandSetting[] {
    return bandSettingsFrom(DEFAULT_GYM_BANDS, (band) =>
        t(`gradeConversion.bands.${band.key}`),
    )
}

const {
    form: copySettings,
    pristine: original,
    reset: resetDraft,
    commit,
} = useDraft(settings, (rec) => gymSettingsDraft(rec, defaultBandSettings))
const settingsForm = ref<Form<typeof copySettings> | null>(null)

function validateSettings(state: typeof copySettings) {
    return validateRules(state, {
        contact_email: [(email) => !email || validEmail(t)(email)],
        opening_hours: [
            (hours) =>
                isValidOpeningHours(hours) ||
                t('gymInfo.settings.invalidHours'),
        ],
        privacy_doc: [
            (doc) => privacyDocProblem(doc as RichTextDoc, t) || true,
        ],
        tv_settings: [
            (tv) =>
                isValidTvSettings(
                    tvSettingsPayload(tv as ResolvedTvSettings),
                ) || t('settings.tv.invalid'),
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

function changedFieldsPayload() {
    return changedGymSettings(copySettings, original.value)
}

const { pending: saving, run: runSave } = useAsyncAction()

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
    const objectUrl = useObjectUrl(file)
    watch(objectUrl, (url) => {
        if (url) preview.value = url
    })
    const stored = (rec: Partial<GymRecord> | null | undefined) =>
        fileUrl('gyms', rec, rec?.[field]) || null
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
            const reselected = !!selected && selected === file.value
            file.value = selected
            clear.value = false
            if (!selected) preview.value = stored(settings.value)
            else if (reselected) preview.value = objectUrl.value ?? null
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
        id: 'tv',
        label: t('settings.tv.title'),
        icon: 'i-lucide-tv',
    },
    {
        id: 'grading',
        label: t('settings.grading'),
        icon: 'i-lucide-trending-up',
    },
    ...(hasFeature(settings.value, 'beta_links') ||
    hasFeature(settings.value, 'beta_uploads')
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
    {
        id: 'privacy',
        label: t('settings.privacy.title'),
        icon: 'i-lucide-shield-user',
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
    resetDraft()
}

watch(
    settings,
    (rec) => {
        if (rec)
            for (const asset of assets) asset.preview.value = asset.stored(rec)
    },
    { immediate: true },
)

async function saveSettings() {
    if (!hasChanges.value || saving.value) return
    await runSave(
        async () => {
            const files: GymFiles = {}
            for (const asset of assets) {
                if (asset.file.value) files[asset.field] = asset.file.value
                else if (asset.clear.value) files[asset.field] = null
            }

            const updated = await updateGym(
                settings.value!.id,
                changedFieldsPayload() as GymInput,
                files,
            )

            for (const asset of assets) asset.reset(updated)

            commit(updated)
            emit('saved', updated)
        },
        {
            success: t('settings.saveSuccess'),
            error: t('settings.saveError'),
        },
    )
}
</script>
