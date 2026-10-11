<script setup lang="ts">
import { fileUrl } from '~/api/client'
import type { GymRecord } from '~/types/models'
import { hasLocation } from '~/utils/gymInfo'
import { gymSubtitle, gymTitle } from '~/utils/gymNames'

const props = defineProps<{ gym: GymRecord }>()
defineEmits<{ close: [] }>()

const logoUrl = computed(() =>
    props.gym.page_logo
        ? fileUrl('gyms', props.gym, props.gym.page_logo, { thumb: '0x200' })
        : '',
)
const { status, label } = useOpenStatus(() => props.gym.opening_hours)
</script>

<template>
    <article
        class="flex flex-col gap-3 rounded-lg border border-default bg-default p-3 shadow-lg"
        data-testid="gym-map-card"
    >
        <div class="flex items-start gap-3">
            <img
                v-if="logoUrl"
                :src="logoUrl"
                alt=""
                class="logo-mono size-10 shrink-0 object-contain"
            />
            <div class="min-w-0 flex-1">
                <h2 class="truncate font-semibold">{{ gymTitle(gym) }}</h2>
                <p v-if="gymSubtitle(gym)" class="truncate text-sm text-muted">
                    {{ gymSubtitle(gym) }}
                </p>
            </div>
            <UButton
                :to="`/${gym.slug}/info`"
                icon="i-lucide-info"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('routes.info')"
                data-testid="gym-map-card-info"
            />
            <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                class="icon-btn"
                :aria-label="$t('actions.close')"
                data-testid="gym-map-card-close"
                @click="$emit('close')"
            />
        </div>

        <div class="flex flex-col gap-1 text-sm">
            <span v-if="status" class="flex items-center gap-2">
                <UIcon name="i-lucide-clock" class="size-4 text-muted" />
                <span :class="status.open && 'text-success'">{{ label }}</span>
            </span>
            <span v-if="gym.address" class="flex items-center gap-2">
                <UIcon
                    name="i-lucide-map-pin"
                    class="size-4 shrink-0 text-muted"
                />
                <span class="truncate">{{ gym.address }}</span>
            </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <UButton
                :to="`/${gym.slug}`"
                trailing-icon="i-lucide-arrow-right"
                :label="$t('landing.openGym')"
                data-testid="gym-map-card-open"
            />
            <GymDirectionsButton v-if="hasLocation(gym)" :gym="gym" />
        </div>
    </article>
</template>
