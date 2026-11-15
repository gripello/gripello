<template>
    <span
        v-if="uses.length"
        class="flex flex-wrap gap-1.5"
        :data-testid="testId"
    >
        <UBadge
            v-for="use in uses"
            :key="use.key"
            :label="$t(`gymInfo.settings.uses.${use.key}`)"
            color="neutral"
            :variant="use.fallback ? 'outline' : 'subtle'"
            size="sm"
            :class="
                use.fallback &&
                'border border-dashed border-accented text-muted ring-0'
            "
            :data-fallback="use.fallback || undefined"
        />
    </span>
</template>

<script setup lang="ts">
import type { ContactUse } from '~/utils/gymContactUses'

defineProps<{ uses: ContactUse[]; testId?: string }>()
</script>
