<script setup lang="ts">
import type { SortOption } from '~/utils/sorting'

export interface SortItem {
    title: string
    key: string
    defaultOrder?: 'asc' | 'desc'
}

const modelValue = defineModel<SortOption[]>({ default: () => [] })

const props = defineProps<{
    items: SortItem[]
}>()

const activeKey = computed(() => modelValue.value[0]?.key ?? null)
const isDescending = computed(() => modelValue.value[0]?.order === 'desc')

function onKeyChange(key: string | null) {
    if (!key || key === activeKey.value) return
    const item = props.items.find((i) => i.key === key)
    modelValue.value = [{ key, order: item?.defaultOrder ?? 'asc' }]
}

function toggleOrder() {
    const current = modelValue.value[0]
    if (!current) return
    modelValue.value = [
        { key: current.key, order: isDescending.value ? 'asc' : 'desc' },
    ]
}
</script>

<template>
    <div class="flex items-center gap-2">
        <USelect
            :model-value="activeKey ?? undefined"
            :items="props.items"
            :placeholder="$t('table.sort_by')"
            :aria-label="$t('table.sort_by')"
            label-key="title"
            value-key="key"
            class="grow"
            data-testid="sort-field"
            @update:model-value="onKeyChange"
        />
        <UButton
            class="icon-btn"
            variant="soft"
            color="neutral"
            :icon="
                isDescending
                    ? 'i-lucide-arrow-down-wide-narrow'
                    : 'i-lucide-arrow-up-narrow-wide'
            "
            :disabled="!activeKey"
            data-testid="sort-order-toggle"
            :aria-label="
                isDescending ? $t('table.sort_desc') : $t('table.sort_asc')
            "
            @click="toggleOrder"
        />
    </div>
</template>
