<template>
    <UIcon
        v-if="severity"
        :name="urgent ? 'i-lucide-octagon-alert' : 'i-lucide-triangle-alert'"
        role="img"
        :aria-label="label"
        :title="label"
        class="shrink-0"
        :class="[
            urgent ? 'text-error' : 'text-warning',
            size === 'sm' ? 'size-[14px]' : 'size-4',
        ]"
        data-testid="route-defect-marker"
        :data-severity="severity"
    />
</template>

<script setup lang="ts">
import type { DefectSeverity } from '~/utils/tasks'

const props = defineProps<{ severity?: DefectSeverity; size?: 'sm' | 'md' }>()

const { t } = useI18n()
const urgent = computed(() => props.severity === 'urgent')
const label = computed(() =>
    t(urgent.value ? 'tasks.defect.urgentMarker' : 'tasks.defect.marker'),
)
</script>
