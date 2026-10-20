<template>
    <LayoutPanel id="settings-grading" :title="$t('settings.grading')">
        <div :class="SETTINGS_FIELDS_GRID">
            <UFormField
                :label="$t('settings.routeGradeSystem')"
                :ui="SETTINGS_FIELD_UI"
            >
                <USelect
                    v-model="form.route_grade_system"
                    :items="routeSystems"
                    icon="i-lucide-trending-up"
                    class="w-full"
                    data-testid="settings-route-grade-system"
                />
            </UFormField>
            <UFormField
                :label="$t('settings.boulderGradeSystem')"
                :ui="SETTINGS_FIELD_UI"
            >
                <USelect
                    v-model="form.boulder_grade_system"
                    :items="boulderSystems"
                    icon="i-lucide-box"
                    class="w-full"
                    data-testid="settings-boulder-grade-system"
                />
            </UFormField>
            <UFormField
                :label="$t('settings.boulderBands')"
                :help="$t('settings.boulderBandsHint')"
                :ui="SETTINGS_FIELD_UI"
                class="lg:col-span-2"
            >
                <AdminBoulderBandEditor v-model="form.boulder_bands" />
                <div class="mt-3 flex flex-wrap gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        icon="i-lucide-rotate-ccw"
                        data-testid="settings-boulder-band-reset"
                        @click="emit('resetBands')"
                    >
                        {{ $t('settings.resetBands') }}
                    </UButton>
                </div>
            </UFormField>
        </div>
        <div>
            <GradeConversionDialog />
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
import {
    BOULDER_GRADE_SYSTEMS,
    ROUTE_GRADE_SYSTEMS,
} from '#shared/utils/grades'
import type { GymSettingsDraft } from '~/utils/gymSettingsDraft'
import { SETTINGS_FIELD_UI, SETTINGS_FIELDS_GRID } from '~/utils/settingsUi'
import { translatedItems } from '~/utils/translatedItems'

defineProps<{ form: GymSettingsDraft }>()
const emit = defineEmits<{ resetBands: [] }>()

const { t } = useI18n()
const routeSystems = computed(() =>
    translatedItems<string>(ROUTE_GRADE_SYSTEMS, 'gradeSystems', t),
)
const boulderSystems = computed(() =>
    translatedItems<string>(BOULDER_GRADE_SYSTEMS, 'gradeSystems', t),
)
</script>
