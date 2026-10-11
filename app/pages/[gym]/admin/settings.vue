<template>
    <div class="w-full p-4">
        <LayoutPageHeader
            :title="$t('page.content.settings')"
            :subtitle="$t('settings.description')"
        />

        <UAlert
            v-if="!mailConfigured"
            color="info"
            variant="soft"
            icon="i-lucide-mail-x"
            class="mb-4"
            data-testid="settings-mail-warning"
        >
            <template #description>
                <span class="alert-message">{{
                    $t('settings.mailNotConfigured')
                }}</span>
            </template>
        </UAlert>

        <AdminGymSettingsForm
            :gym="gym"
            :extra-sections="extraSections"
            @saved="gym = $event"
        >
            <template #locations>
                <AdminLocationsCard id="settings-locations-section" />
            </template>
        </AdminGymSettingsForm>
    </div>
</template>

<script setup lang="ts">
const { t } = useI18n()

useHead({
    title: t('page.title.settings'),
    meta: [{ name: 'description', content: t('page.content.settings') }],
})

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_settings',
})

const { gym } = useGym()

const { data: mailStatus } = useMailStatus()
const mailConfigured = computed(() => mailStatus.value?.configured !== false)

const extraSections = computed(() => [
    {
        id: 'locations',
        label: t('settings.locations'),
        icon: 'i-lucide-map-pin',
        after: 'organization',
    },
])
</script>
