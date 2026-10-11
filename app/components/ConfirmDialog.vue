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
        data-testid="confirm-dialog"
    >
        <div class="text-sm text-muted">{{ message }}</div>
        <slot />
        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="confirm-dialog-cancel"
                @click="open = false"
            >
                {{ $t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                :color="confirmColor"
                :loading="loading"
                data-testid="confirm-dialog-confirm"
                @click="emit('confirm')"
            >
                {{ confirmText ?? $t('actions.delete') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>
