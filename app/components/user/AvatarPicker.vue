<template>
    <div class="flex items-center gap-3">
        <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/svg+xml,image/webp"
            class="hidden"
            :data-testid="`${testIdPrefix}-avatar-input`"
            @change="onFileChange"
        />
        <UTooltip :text="$t('account.changeAvatar')">
            <div
                class="avatar-wrapper"
                role="button"
                tabindex="0"
                :aria-label="$t('account.changeAvatar')"
                :data-testid="`${testIdPrefix}-avatar-upload`"
                @click="openPicker"
                @keydown.enter.prevent="openPicker"
                @keydown.space.prevent="openPicker"
            >
                <UAvatar
                    :src="preview || undefined"
                    :alt="$t('account.changeAvatar')"
                    icon="i-lucide-user"
                    class="avatar-ring size-16 text-[32px]"
                />
                <div class="avatar-overlay">
                    <UIcon
                        name="i-lucide-camera"
                        class="size-[18px] text-white"
                    />
                </div>
            </div>
        </UTooltip>
        <UButton
            v-if="removable && preview"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            class="icon-btn"
            :aria-label="$t('settings.removeImage')"
            :data-testid="`${testIdPrefix}-avatar-remove`"
            @click="emit('remove')"
        />
    </div>
</template>

<script setup lang="ts">
defineProps<{
    preview: string | null
    testIdPrefix: string
    removable?: boolean
}>()
const emit = defineEmits<{ select: [file: File]; remove: [] }>()

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

function openPicker() {
    fileInput.value?.click()
}

function onFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) emit('select', file)
    input.value = ''
}
</script>
