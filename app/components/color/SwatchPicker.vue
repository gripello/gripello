<template>
    <div
        ref="root"
        class="flex flex-wrap items-center gap-2"
        :role="hasSwatches ? 'radiogroup' : undefined"
        :aria-label="hasSwatches ? label : undefined"
        @keydown="onKeydown"
    >
        <button
            v-for="(color, index) in swatches"
            :key="color"
            type="button"
            role="radio"
            class="color-swatch"
            :class="{ 'color-swatch--active': isCurrent(color) }"
            :aria-checked="isCurrent(color)"
            :aria-label="swatchLabel(color)"
            :tabindex="index === focusIndex ? 0 : -1"
            :style="{ backgroundColor: color }"
            :data-testid="
                testIdPrefix &&
                `${testIdPrefix}-swatch-${toHex6(color).slice(1)}`
            "
            @click="model = color"
        />
        <UPopover :content="{ side: 'top', align: 'end' }">
            <button
                type="button"
                class="color-swatch color-swatch--custom"
                :class="{ 'color-swatch--active': isCustom }"
                :role="hasSwatches ? 'radio' : undefined"
                :aria-checked="hasSwatches ? isCustom : undefined"
                :tabindex="
                    !hasSwatches || focusIndex === swatches.length ? 0 : -1
                "
                :style="isCustom ? { background: model } : undefined"
                :aria-label="customLabel"
                :data-testid="testIdPrefix && `${testIdPrefix}-color-custom`"
            >
                <UIcon
                    name="i-lucide-pipette"
                    class="size-5"
                    :class="{ 'text-white drop-shadow': !isCustom }"
                    :style="
                        isCustom ? { color: readableTextOn(model) } : undefined
                    "
                />
            </button>
            <template #content>
                <div class="flex w-60 flex-col gap-3 p-3">
                    <UColorPicker v-model="model" class="mx-auto" />
                    <UInput
                        :model-value="hexDraft"
                        :aria-label="t('climbing.customColor')"
                        :aria-invalid="!!hexDraft && !parseHexColor(hexDraft)"
                        class="w-full font-mono"
                        :data-testid="
                            testIdPrefix && `${testIdPrefix}-color-hex`
                        "
                        @update:model-value="typeHex"
                    >
                        <template #leading>
                            <span
                                class="size-4 rounded-full ring ring-default"
                                :style="{ backgroundColor: model }"
                            />
                        </template>
                    </UInput>
                </div>
            </template>
        </UPopover>
    </div>
</template>

<script setup lang="ts">
import { parseHexColor, toHex6 } from '#shared/utils/color'
import { readableTextOn } from '~/utils/color'
import { translatedColorName } from '~/utils/colorName'
import { useRadioArrowKeys } from '~/composables/useRadioArrowKeys'

const props = withDefaults(
    defineProps<{
        label: string
        swatches?: readonly string[]
        testIdPrefix?: string
    }>(),
    { swatches: () => [], testIdPrefix: undefined },
)

const model = defineModel<string>({ default: '' })

const { t } = useI18n()

const root = useTemplateRef<HTMLElement>('root')

const hasSwatches = computed(() => props.swatches.length > 0)

const isCurrent = (color: string) =>
    !!model.value && toHex6(model.value) === toHex6(color)

const isCustom = computed(
    () => !!model.value && !props.swatches.some(isCurrent),
)

const focusIndex = computed(() =>
    isCustom.value
        ? props.swatches.length
        : Math.max(0, props.swatches.findIndex(isCurrent)),
)

const swatchLabel = (color: string) =>
    [translatedColorName(t, color), color].filter(Boolean).join(', ')

const customLabel = computed(() =>
    isCustom.value
        ? `${t('climbing.customColor')}, ${toHex6(model.value)}`
        : t('climbing.customColor'),
)

const onKeydown = useRadioArrowKeys(root, (index) => {
    const swatch = props.swatches[index]
    if (swatch) model.value = swatch
})

const hexDraft = ref(model.value)
watch(model, (value) => {
    if (!value || toHex6(value) !== toHex6(hexDraft.value))
        hexDraft.value = value
})

function typeHex(value: string | number) {
    hexDraft.value = String(value)
    const trimmed = hexDraft.value.trim()
    if (!trimmed) model.value = ''
    else if (parseHexColor(trimmed))
        model.value = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}
</script>

<style scoped>
.color-swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 18%, transparent);
    transition:
        box-shadow 0.15s,
        transform 0.15s;
}

@media (pointer: coarse) {
    .color-swatch {
        width: 44px;
        height: 44px;
    }
}

.color-swatch:hover {
    transform: scale(1.08);
}

.color-swatch--active {
    box-shadow:
        0 0 0 2px var(--ui-bg),
        0 0 0 4px var(--ui-primary);
}

.color-swatch--custom {
    background: conic-gradient(
        from 90deg,
        #f44336,
        #ffeb3b,
        #4caf50,
        #03a9f4,
        #9c27b0,
        #f44336
    );
}
</style>
