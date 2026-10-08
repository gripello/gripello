<template>
    <div class="flex flex-col gap-3" data-testid="boulder-band-editor">
        <div>
            <div
                ref="barRef"
                class="band-bar"
                :style="{ '--steps': font.length }"
            >
                <button
                    v-for="(band, index) in bands"
                    :key="index"
                    type="button"
                    class="band-bar__segment"
                    :class="{
                        'band-bar__segment--selected': index === selected,
                    }"
                    :style="{
                        gridColumn: `span ${band.span}`,
                        background: band.color,
                        color: readableTextOn(band.color),
                    }"
                    :aria-pressed="index === selected"
                    :title="band.name"
                    data-testid="boulder-band-segment"
                    @click="selected = index"
                >
                    <span class="truncate">{{ band.name }}</span>
                </button>
                <span
                    v-for="(boundary, index) in boundaries"
                    :key="`handle-${index}`"
                    class="band-bar__handle"
                    :style="{
                        left: `${((boundary + 1) / font.length) * 100}%`,
                    }"
                    role="slider"
                    tabindex="0"
                    :aria-label="
                        $t('settings.bandBoundary', {
                            from: model[index]!.name,
                            to: model[index + 1]!.name,
                        })
                    "
                    :aria-valuemin="0"
                    :aria-valuemax="font.length - 1"
                    :aria-valuenow="boundary"
                    :aria-valuetext="font[boundary]"
                    data-testid="boulder-band-handle"
                    @pointerdown="startDrag($event, index)"
                    @keydown.left.prevent="move(index, boundary - 1)"
                    @keydown.right.prevent="move(index, boundary + 1)"
                />
            </div>
            <div class="band-axis" :style="{ '--steps': font.length }">
                <span v-for="grade in font" :key="grade">{{ grade }}</span>
            </div>
        </div>

        <div
            v-if="current"
            class="flex flex-wrap items-end gap-3 rounded-lg p-3 ring ring-default"
            data-testid="boulder-band-details"
        >
            <UFormField :label="$t('settings.bandColor')">
                <UPopover :content="{ side: 'bottom', align: 'start' }">
                    <button
                        type="button"
                        class="band-color"
                        :style="{ background: current.color }"
                        :aria-label="$t('settings.bandColor')"
                        data-testid="boulder-band-color"
                    />
                    <template #content>
                        <div class="flex w-60 flex-col gap-3 p-3">
                            <UColorPicker
                                :model-value="current.color"
                                @update:model-value="setColor"
                                class="mx-auto"
                            />
                            <UInput
                                :model-value="current.color"
                                @update:model-value="setColor"
                                :aria-label="$t('settings.bandColor')"
                                class="w-full font-mono"
                                data-testid="boulder-band-color-hex"
                            >
                                <template #leading>
                                    <span
                                        class="size-4 rounded-full ring ring-default"
                                        :style="{ background: current.color }"
                                    />
                                </template>
                            </UInput>
                        </div>
                    </template>
                </UPopover>
            </UFormField>
            <UFormField
                :label="$t('settings.bandName')"
                class="min-w-40 flex-1"
            >
                <UInput
                    v-model="current.name"
                    class="w-full"
                    data-testid="boulder-band-name"
                />
            </UFormField>
            <div class="flex flex-col gap-1 text-sm">
                <span class="text-muted">Fb</span>
                <span
                    class="py-2 font-medium"
                    data-testid="boulder-band-range"
                    >{{ rangeOf(selected) }}</span
                >
            </div>
            <div class="flex gap-1">
                <UButton
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-split"
                    :disabled="bands[selected]!.span < 2"
                    data-testid="boulder-band-split"
                    @click="split"
                >
                    {{ $t('settings.splitBand') }}
                </UButton>
                <UButton
                    class="icon-btn"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :disabled="model.length <= 1"
                    :aria-label="$t('settings.removeBand')"
                    :title="$t('settings.removeBand')"
                    data-testid="boulder-band-remove"
                    @click="remove"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    bandBoundaries,
    gymBandsFrom,
    moveBandBoundary,
    splitBand,
    type BoulderBandSetting,
} from '#shared/utils/gradeReference'
import { gradeLabels } from '#shared/utils/grades'
import { renamedForColor, translatedColorName } from '~/utils/colorName'

const model = defineModel<BoulderBandSetting[]>({ required: true })

const { t } = useI18n()

const font = gradeLabels('font')
const selected = ref(0)
const barRef = useTemplateRef('barRef')

const bands = computed(() => gymBandsFrom(model.value))
const boundaries = computed(() => bandBoundaries(model.value))
const current = computed(() => model.value[selected.value])

watch(
    () => model.value.length,
    (length) => {
        if (selected.value >= length) selected.value = length - 1
    },
)

function rangeOf(index: number) {
    const start = (boundaries.value[index - 1] ?? -1) + 1
    const end = boundaries.value[index] ?? font.length - 1
    return start === end ? font[start] : `${font[start]} – ${font[end]}`
}

function move(index: number, position: number) {
    model.value = moveBandBoundary(model.value, index, position)
}

function startDrag(event: PointerEvent, index: number) {
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const onMove = (moveEvent: PointerEvent) => {
        const rect = barRef.value!.getBoundingClientRect()
        const fraction = (moveEvent.clientX - rect.left) / rect.width
        move(index, Math.round(fraction * font.length) - 1)
    }
    const stop = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', stop)
        handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
}

function setColor(color: string | undefined) {
    const band = current.value
    if (!band || !color) return
    band.name = renamedForColor(t, band.name, band.color, color)
    band.color = color
}

function split() {
    const next = splitBand(model.value, selected.value)
    if (next === model.value) return
    const added = next[selected.value + 1]!
    added.name = translatedColorName(t, added.color)
    model.value = next
    selected.value += 1
}

function remove() {
    model.value = model.value.filter((_, i) => i !== selected.value)
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.band-bar {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--steps), minmax(0, 1fr));
    height: 48px;
    overflow: visible;
    border-radius: var(--ui-radius);
    box-shadow: inset 0 0 0 1px var(--ui-border);
}

.band-bar__segment {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px
        color-mix(in oklab, var(--ui-text-highlighted) 12%, transparent);
}

.band-bar__segment:first-of-type {
    border-radius: var(--ui-radius) 0 0 var(--ui-radius);
}

.band-bar__segment:last-of-type {
    border-radius: 0 var(--ui-radius) var(--ui-radius) 0;
}

.band-bar__segment--selected {
    outline: 3px solid var(--ui-primary);
    outline-offset: 2px;
    position: relative;
    z-index: 1;
}

.band-bar__handle {
    position: absolute;
    top: -6px;
    bottom: -6px;
    z-index: 2;
    width: 24px;
    transform: translateX(-50%);
    cursor: ew-resize;
    touch-action: none;
}

.band-bar__handle::after {
    content: '';
    position: absolute;
    inset: 0 9px;
    border-radius: 999px;
    background: var(--ui-bg);
    box-shadow:
        0 0 0 1px var(--ui-border-accented),
        0 1px 3px rgb(0 0 0 / 0.25);
}

.band-bar__handle:focus-visible::after,
.band-bar__handle:hover::after {
    box-shadow:
        0 0 0 2px var(--ui-primary),
        0 1px 3px rgb(0 0 0 / 0.25);
}

.band-axis {
    display: grid;
    grid-template-columns: repeat(var(--steps), minmax(0, 1fr));
    margin-top: 6px;
    color: var(--ui-text-muted);
    font-size: 0.65rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.band-color {
    display: block;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    box-shadow:
        0 0 0 2px var(--ui-bg),
        0 0 0 3px var(--ui-border-accented);
    transition: transform 0.15s;
}

.band-color:hover {
    transform: scale(1.08);
}

@variant max-sm {
    .band-axis span:nth-child(even) {
        visibility: hidden;
    }
}
</style>
