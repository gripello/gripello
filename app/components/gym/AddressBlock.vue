<template>
    <div class="flex flex-wrap items-center justify-between gap-3">
        <component
            :is="href ? 'a' : 'p'"
            v-if="lines.length"
            :href="href || undefined"
            :target="href && !href.startsWith('geo:') ? '_blank' : undefined"
            rel="noopener"
            class="group flex min-w-0 items-center gap-3"
            data-testid="gym-info-address"
        >
            <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
                <UIcon name="i-lucide-map-pin" class="size-5" />
            </span>
            <span class="flex min-w-0 flex-col text-sm">
                <span
                    class="truncate font-semibold text-highlighted"
                    :class="href && 'group-hover:underline'"
                    >{{ lines[0] }}</span
                >
                <span
                    v-for="(line, index) in lines.slice(1)"
                    :key="index"
                    class="truncate text-muted"
                    >{{ line }}</span
                >
            </span>
        </component>
        <GymDirectionsButton v-if="hasLocation(gym)" :gym="gym" />
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import { addressParts, hasLocation } from '~/utils/gymInfo'

const props = defineProps<{
    gym: Pick<GymRecord, 'latitude' | 'longitude' | 'address'>
}>()

const href = useDirectionsHref(() => props.gym)
const lines = computed(() => addressParts(props.gym.address ?? ''))
</script>
