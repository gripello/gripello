<template>
    <div
        ref="root"
        role="radiogroup"
        :aria-label="label"
        class="grid gap-2"
        :class="cols"
        @keydown="onKeydown"
    >
        <UButton
            v-for="(item, index) in items"
            :key="String(item.value)"
            role="radio"
            :aria-checked="item.value === modelValue"
            :tabindex="index === focusIndex ? 0 : -1"
            :icon="item.icon"
            :color="
                item.value === modelValue
                    ? (item.color ?? 'primary')
                    : 'neutral'
            "
            :variant="item.value === modelValue ? 'soft' : 'outline'"
            :disabled="disabled"
            class="min-h-11 justify-center text-center"
            :data-testid="
                testIdPrefix && `${testIdPrefix}-${item.id ?? item.value}`
            "
            @click="pick(item.value)"
        >
            {{ item.label }}
        </UButton>
    </div>
</template>

<script setup lang="ts" generic="T extends string | number | null">
import type { ButtonProps } from '@nuxt/ui'
import { useRadioArrowKeys } from '~/composables/useRadioArrowKeys'

export interface OptionGridItem<V> {
    value: V
    label: string
    id?: string
    icon?: string
    color?: ButtonProps['color']
}

const props = withDefaults(
    defineProps<{
        items: OptionGridItem<NonNullable<T>>[]
        label: string
        cols?: string
        deselectable?: boolean
        disabled?: boolean
        testIdPrefix?: string
    }>(),
    { cols: 'grid-cols-2', testIdPrefix: undefined },
)

const modelValue = defineModel<T>({ required: true })

const root = useTemplateRef<HTMLElement>('root')

const focusIndex = computed(() =>
    Math.max(
        0,
        props.items.findIndex((item) => item.value === modelValue.value),
    ),
)

function pick(value: NonNullable<T>) {
    modelValue.value =
        props.deselectable && value === modelValue.value ? (null as T) : value
}

const onKeydown = useRadioArrowKeys(root, (index) => {
    modelValue.value = props.items[index]!.value
})
</script>
