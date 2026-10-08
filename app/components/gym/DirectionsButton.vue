<script setup lang="ts">
import type { GymRecord } from '~/types/models'
import { directionLinks, preferredDirections } from '~/utils/gymInfo'

const props = defineProps<{
    gym: Pick<GymRecord, 'latitude' | 'longitude' | 'address'>
}>()
const { t } = useI18n()

const links = computed(() => directionLinks(props.gym))
const userAgent = ref('')
onMounted(() => (userAgent.value = navigator.userAgent))
const href = computed(() => preferredDirections(props.gym, userAgent.value))
const items = computed(() =>
    links.value.map((link) => ({
        label: t(`gymInfo.directions.${link.key}`),
        to: link.href,
        target: '_blank',
    })),
)
</script>

<template>
    <UFieldGroup>
        <UButton
            :href="href"
            :target="href.startsWith('geo:') ? undefined : '_blank'"
            rel="noopener"
            color="neutral"
            variant="subtle"
            icon="i-lucide-navigation"
            :label="$t('gymInfo.directions.route')"
            data-testid="gym-directions"
        />
        <UDropdownMenu :items="items">
            <UButton
                color="neutral"
                variant="subtle"
                icon="i-lucide-chevron-down"
                :aria-label="$t('gymInfo.directions.other')"
                data-testid="gym-directions-more"
            />
        </UDropdownMenu>
    </UFieldGroup>
</template>
