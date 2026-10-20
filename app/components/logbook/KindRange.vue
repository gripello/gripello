<template>
    <SegmentedControl
        v-model="kind"
        :items="translatedItems(LOGBOOK_KINDS, 'ticks.kind', t)"
        size="sm"
        :test-id="`${testIdPrefix}-kind`"
    />
    <SegmentedControl
        v-model="range"
        :items="translatedItems(LOGBOOK_RANGES, 'ticks.range', t)"
        size="sm"
        :test-id="`${testIdPrefix}-range`"
    />
</template>

<script setup lang="ts">
import {
    LOGBOOK_KINDS,
    LOGBOOK_RANGES,
    type LogbookKind,
    type LogbookRange,
} from '#shared/utils/logbook'
import { translatedItems } from '~/utils/translatedItems'

defineProps<{ testIdPrefix: string }>()

const kind = defineModel<LogbookKind>('kind', { required: true })
const range = defineModel<LogbookRange>('range', { required: true })

const { t } = useI18n()
</script>
