<template>
    <LayoutPanel id="settings-branding" :title="$t('settings.branding')">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <article
                v-for="asset in assets"
                :key="asset.key"
                class="asset-card"
                :class="{ 'asset-card--dirty': asset.isDirty }"
            >
                <button
                    type="button"
                    class="asset-card__preview"
                    :class="{
                        'asset-card__preview--empty': !asset.preview.value,
                    }"
                    :data-testid="`settings-asset-${asset.key}`"
                    :aria-label="`${asset.label}: ${asset.preview.value ? $t('settings.replace') : $t('settings.clickToUpload')}`"
                    @click="asset.triggerInput()"
                >
                    <img
                        v-if="asset.preview.value"
                        :src="asset.preview.value"
                        :alt="asset.label"
                        class="asset-card__image"
                        :class="{
                            'asset-card__image--mono': asset.key === 'logo',
                        }"
                    />
                    <span
                        v-else
                        class="flex flex-col items-center gap-2 text-sm text-muted"
                    >
                        <UIcon name="i-lucide-image-plus" class="size-8" />
                        {{ $t('settings.clickToUpload') }}
                    </span>
                </button>

                <div class="flex flex-1 flex-col gap-1 pt-3">
                    <div class="flex items-center gap-2">
                        <span
                            class="font-semibold text-highlighted"
                            :data-testid="`settings-asset-label-${asset.key}`"
                            >{{ asset.label }}</span
                        >
                        <UBadge
                            v-if="asset.isDirty"
                            color="warning"
                            size="sm"
                            variant="soft"
                        >
                            {{ $t('settings.changed') }}
                        </UBadge>
                    </div>

                    <div class="mt-auto flex flex-wrap items-center gap-2 pt-3">
                        <div
                            v-if="asset.preview.value"
                            class="flex flex-wrap gap-2"
                            :data-testid="`settings-asset-actions-${asset.key}`"
                        >
                            <UButton
                                color="neutral"
                                variant="outline"
                                size="sm"
                                icon="i-lucide-image-up"
                                :data-testid="`settings-asset-replace-${asset.key}`"
                                @click="asset.triggerInput()"
                            >
                                {{ $t('settings.replace') }}
                            </UButton>
                            <UButton
                                v-if="!asset.isDirty"
                                color="error"
                                variant="ghost"
                                size="sm"
                                icon="i-lucide-trash-2"
                                :data-testid="`settings-asset-delete-${asset.key}`"
                                @click="asset.onDelete()"
                            >
                                {{ $t('settings.removeImage') }}
                            </UButton>
                        </div>
                        <UButton
                            v-else
                            color="neutral"
                            variant="outline"
                            size="sm"
                            icon="i-lucide-upload"
                            @click="asset.triggerInput()"
                        >
                            {{ $t('settings.clickToUpload') }}
                        </UButton>
                        <UButton
                            v-if="asset.isDirty"
                            color="neutral"
                            variant="ghost"
                            size="sm"
                            icon="i-lucide-undo-2"
                            @click="asset.onRevert()"
                        >
                            {{ $t('settings.revertChange') }}
                        </UButton>
                    </div>
                </div>

                <input
                    :ref="
                        (el) => {
                            asset.inputRef.value = el as HTMLInputElement | null
                        }
                    "
                    type="file"
                    :accept="asset.accept"
                    class="hidden"
                    @change="onFileChange($event, asset.onSelect)"
                />
            </article>
        </div>
    </LayoutPanel>
</template>

<script setup lang="ts">
import type { Ref } from 'vue'

defineProps<{
    assets: {
        key: string
        label: string
        accept: string
        preview: Ref<string | null>
        inputRef: Ref<HTMLInputElement | null>
        isDirty: boolean
        onSelect: (file: File | null) => void
        onRevert: () => void
        onDelete: () => void
        triggerInput: () => void
    }[]
}>()

function onFileChange(event: Event, onSelect: (file: File | null) => void) {
    const input = event.target as HTMLInputElement
    onSelect(input.files?.[0] ?? null)
    input.value = ''
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.asset-card {
    display: flex;
    flex-direction: column;
}

.asset-card__preview {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 160px;
    padding: 24px;
    border: 1px solid var(--ui-border);
    border-radius: calc(var(--ui-radius) * 2);
    transition: border-color 0.18s;
    background-color: #f4f4f5;
    background-image:
        linear-gradient(45deg, #e4e4e7 25%, transparent 25%),
        linear-gradient(-45deg, #e4e4e7 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #e4e4e7 75%),
        linear-gradient(-45deg, transparent 75%, #e4e4e7 75%);
    background-size: 16px 16px;
    background-position:
        0 0,
        0 8px,
        8px -8px,
        -8px 0;
    cursor: pointer;
}

.asset-card__preview--empty {
    background: var(--ui-bg-muted);
    border-style: dashed;
}

.asset-card--dirty .asset-card__preview {
    border-color: var(--ui-primary);
}

.asset-card__preview:hover,
.asset-card__preview:focus-visible {
    outline: 2px solid var(--ui-primary);
    outline-offset: -2px;
}

.asset-card__image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.asset-card__image--mono {
    filter: brightness(0);
}
</style>
