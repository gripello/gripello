<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

const open = defineModel<boolean>({ default: false })

withDefaults(
    defineProps<{
        title?: string
        message?: string
        confirmText?: string
        confirmColor?: ButtonProps['color']
        loading?: boolean
        maxWidth?: string | number
    }>(),
    {
        confirmColor: 'error',
        maxWidth: 420,
    },
)

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
    <LayoutDialogShell
        v-model="open"
        :title="title"
        :max-width="maxWidth"
        :submit-label="confirmText ?? $t('actions.delete')"
        :submit-color="confirmColor"
        :submit-loading="loading"
        submit-test-id="confirm-dialog-confirm"
        cancel-test-id="confirm-dialog-cancel"
        data-testid="confirm-dialog"
        @submit="emit('confirm')"
    >
        <div class="text-sm text-muted">{{ message }}</div>
        <slot />
    </LayoutDialogShell>
</template>
