<template>
    <NuxtLink
        :to="gymPath('/')"
        class="flex shrink-0 items-center no-underline"
        :aria-label="$t('routes.home')"
        data-testid="nav-logo"
    >
        <img
            v-if="logoUrl"
            :src="logoUrl"
            :alt="logoAlt"
            class="brand-logo__custom logo-mono"
            data-testid="nav-logo-custom"
        />
        <template v-else>
            <img
                src="/gripello-light.svg"
                :alt="logoAlt"
                class="brand-logo__default brand-logo__default--light"
                height="36"
            />
            <img
                src="/gripello-dark.svg"
                :alt="logoAlt"
                class="brand-logo__default brand-logo__default--dark"
                height="36"
            />
        </template>
    </NuxtLink>
</template>

<script setup lang="ts">
import { fileUrl } from '~/api/client'
import type { GymRecord } from '~/types/models'

const props = defineProps<{ gym?: Partial<GymRecord> | null }>()
const gymPath = useGymPath()

const logoAlt = computed(() => props.gym?.name || 'Gripello')
const logoUrl = computed(() =>
    fileUrl('gyms', props.gym, props.gym?.page_logo, { thumb: '0x200' }),
)
</script>

<style scoped>
.brand-logo__custom {
    max-width: 90px;
    max-height: 44px;
    transition: filter 0.3s ease;
}

.brand-logo__default {
    max-width: 120px;
    height: 36px;
}

.brand-logo__default--dark,
.dark .brand-logo__default--light {
    display: none;
}

.dark .brand-logo__default--dark {
    display: inline;
}
</style>
