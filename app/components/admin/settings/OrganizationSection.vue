<template>
    <LayoutPanel
        id="settings-organization"
        :title="$t('settings.organization')"
    >
        <div :class="SETTINGS_FIELDS_GRID">
            <UFormField
                :label="$t('settings.organizationName')"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.name"
                    icon="i-lucide-building-2"
                    :placeholder="$t('settings.organizationNamePlaceholder')"
                    :maxlength="50"
                    class="w-full"
                    data-testid="settings-org-name"
                />
            </UFormField>
            <UFormField
                :label="$t('settings.organizationUnit')"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.unit_name"
                    icon="i-lucide-building-2"
                    :placeholder="$t('settings.organizationUnitPlaceholder')"
                    :maxlength="50"
                    class="w-full"
                    data-testid="settings-org-unit"
                />
            </UFormField>
            <UFormField
                :label="$t('settings.organizationShortName')"
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.short_name"
                    icon="i-lucide-bell"
                    :placeholder="
                        $t('settings.organizationShortNamePlaceholder')
                    "
                    :maxlength="30"
                    class="w-full"
                    data-testid="settings-org-short-name"
                />
            </UFormField>
            <template v-if="editSlug">
                <UFormField
                    :label="$t('platform.gyms.slug')"
                    name="slug"
                    :ui="SETTINGS_FIELD_UI"
                >
                    <UInput
                        v-model="form.slug"
                        icon="i-lucide-link"
                        class="w-full"
                        :ui="{ base: 'font-mono' }"
                        data-testid="platform-gym-slug"
                    />
                </UFormField>
                <UFormField
                    v-if="form.previous_slugs.length"
                    :label="$t('platform.gyms.previousSlugs')"
                    :ui="SETTINGS_FIELD_UI"
                >
                    <div class="flex flex-wrap gap-2">
                        <UBadge
                            v-for="previous in form.previous_slugs"
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
                :ui="SETTINGS_FIELD_UI"
            >
                <UInput
                    v-model="form.contact_email"
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
                :ui="SETTINGS_FIELD_UI"
            >
                <USelect
                    v-model="form.language"
                    :items="languageItems"
                    icon="i-lucide-languages"
                    class="w-full"
                    data-testid="settings-mail-language"
                />
            </UFormField>
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
import type { GymSettingsDraft } from '~/utils/gymSettingsDraft'
import { SETTINGS_FIELD_UI, SETTINGS_FIELDS_GRID } from '~/utils/settingsUi'
import { SUPPORTED_LOCALES } from '~/utils/locales'

const props = defineProps<{ form: GymSettingsDraft; editSlug?: boolean }>()

const languageItems = SUPPORTED_LOCALES.map(({ code, name }) => ({
    label: name,
    value: code as string,
}))

function releaseSlug(slug: string) {
    props.form.previous_slugs = props.form.previous_slugs.filter(
        (entry) => entry !== slug,
    )
}
</script>
