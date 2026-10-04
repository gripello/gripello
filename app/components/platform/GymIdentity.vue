<template>
    <div class="flex min-w-0 items-center gap-3">
        <span
            v-if="logoUrl"
            class="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated p-1"
        >
            <img
                :src="logoUrl"
                alt=""
                class="logo-mono size-full object-contain"
            />
        </span>
        <span
            v-else
            class="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
            :style="{ backgroundColor: avatarColor(title) }"
        >
            {{ nameInitials(title) }}
        </span>
        <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
                <span class="truncate text-sm font-semibold text-highlighted">
                    {{ title }}
                </span>
                <UBadge
                    v-if="!gym.active"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    class="shrink-0"
                    :data-testid="`platform-gym-inactive-${gym.slug}`"
                >
                    {{ $t('platform.gyms.inactive') }}
                </UBadge>
            </div>
            <div class="truncate font-mono text-xs text-muted">
                /{{ gym.slug }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import { avatarColor, nameInitials } from '~/utils/avatar'
import { gymTitle } from '~/utils/gymNames'

const props = defineProps<{ gym: GymRecord }>()

const title = computed(() => gymTitle(props.gym))
const logoUrl = computed(() =>
    usePbFileUrl(props.gym, props.gym.page_logo, { thumb: '0x200' }),
)
</script>
