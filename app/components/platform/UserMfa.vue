<template>
    <UTooltip :text="label">
        <span
            class="inline-flex size-8 items-center justify-center rounded-full"
            :class="tone"
            :data-mfa="enabled ? 'on' : 'off'"
            data-testid="platform-user-mfa"
        >
            <UIcon
                :name="
                    enabled ? 'i-lucide-shield-check' : 'i-lucide-shield-off'
                "
                class="size-5"
            />
            <span class="sr-only">{{ label }}</span>
        </span>
    </UTooltip>
</template>

<script setup lang="ts">
const props = defineProps<{ enabled?: boolean; staff?: boolean }>()

const { t } = useI18n()

const label = computed(() =>
    props.enabled ? t('platform.users.mfaOn') : t('platform.users.mfaOff'),
)
const tone = computed(() => {
    if (props.enabled) return 'bg-success/10 text-success'
    return props.staff ? 'bg-warning/10 text-warning' : 'text-muted'
})
</script>
