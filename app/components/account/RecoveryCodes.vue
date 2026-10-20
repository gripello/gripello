<template>
    <LayoutDialogShell
        :model-value="codes.length > 0"
        persistent
        :title="t('account.twoFactor.recoveryCodes')"
        :max-width="420"
        data-testid="two-factor-codes-dialog"
    >
        <ul
            class="grid grid-cols-2 gap-2 font-mono text-sm"
            data-testid="two-factor-codes"
        >
            <li
                v-for="code in codes"
                :key="code"
                class="rounded-md bg-elevated px-2 py-1 text-center"
            >
                {{ code }}
            </li>
        </ul>
        <template #actions>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-copy"
                @click="copy"
            >
                {{ t('account.twoFactor.copy') }}
            </UButton>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-download"
                data-testid="two-factor-codes-download"
                @click="download"
            >
                {{ t('account.twoFactor.download') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                color="primary"
                data-testid="two-factor-codes-done"
                @click="emit('update:codes', [])"
            >
                {{ t('account.twoFactor.done') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import { saveBlob } from '~/utils/download'

const props = defineProps<{ codes: string[] }>()
const emit = defineEmits<{ 'update:codes': [codes: string[]] }>()

const { t } = useI18n()
const { success, error: notifyError } = useNotification()
const text = computed(() => props.codes.join('\n'))

async function copy() {
    await navigator.clipboard
        .writeText(text.value)
        .then(() => success(t('account.twoFactor.copied')))
        .catch(() => notifyError(t('notifications.error.generic')))
}

function download() {
    void saveBlob(
        new Blob([text.value + '\n'], { type: 'text/plain' }),
        'gripello-recovery-codes.txt',
    ).catch(() => notifyError(t('notifications.error.generic')))
}
</script>
