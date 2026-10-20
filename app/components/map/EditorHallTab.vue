<template>
    <div class="panel-tab">
        <form class="panel-form" @submit.prevent="resize">
            <UFormField :label="$t('mapEditor.width')" class="flex-1">
                <UInput
                    v-model.number="width"
                    type="number"
                    class="w-full"
                    data-testid="map-editor-width"
                >
                    <template #trailing>
                        <span class="text-xs text-muted">m</span>
                    </template>
                </UInput>
            </UFormField>
            <UFormField :label="$t('mapEditor.height')" class="flex-1">
                <UInput
                    v-model.number="height"
                    type="number"
                    class="w-full"
                    data-testid="map-editor-height"
                >
                    <template #trailing>
                        <span class="text-xs text-muted">m</span>
                    </template>
                </UInput>
            </UFormField>
            <UButton
                type="submit"
                color="neutral"
                variant="outline"
                class="self-end"
                :disabled="
                    width === state.map.width && height === state.map.height
                "
            >
                {{ $t('mapEditor.apply') }}
            </UButton>
        </form>
        <p v-if="resizeError" class="text-xs text-error">
            {{ $t('mapEditor.resizeTooSmall') }}
        </p>

        <LayoutEyebrow>{{ $t('mapEditor.trace') }}</LayoutEyebrow>
        <UFileUpload
            v-model="traceFile"
            :accept="TRACE_TYPES.join(',')"
            :label="
                hasTrace
                    ? $t('mapEditor.replaceTrace')
                    : $t('mapEditor.uploadTrace')
            "
            icon="i-lucide-image-plus"
            :variant="hasTrace ? 'button' : 'area'"
            :preview="false"
            class="w-full"
            data-testid="map-editor-trace-upload"
        />
        <template v-if="hasTrace && state.map.trace">
            <UButton
                size="sm"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                class="self-start"
                data-testid="map-editor-trace-remove"
                @click="emit('removeTrace')"
            >
                {{ $t('mapEditor.removeTrace') }}
            </UButton>
            <UFormField :label="$t('mapEditor.traceOpacity')">
                <USlider
                    :model-value="state.map.trace.opacity"
                    :min="0.1"
                    :max="1"
                    :step="0.05"
                    @update:model-value="previewOpacity"
                    @change="editor.endGesture()"
                />
            </UFormField>
            <div class="panel-form">
                <UFormField
                    v-for="traceField in traceFields"
                    :key="traceField.key"
                    :label="traceField.label"
                    class="flex-1"
                >
                    <UInputNumber
                        :model-value="state.map.trace[traceField.key]"
                        :step="0.1"
                        :min="traceField.key === 'width' ? 0.1 : undefined"
                        :increment="false"
                        :decrement="false"
                        class="w-full"
                        @update:model-value="
                            setTraceNumber(traceField.key, $event)
                        "
                    />
                </UFormField>
            </div>
            <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-maximize"
                data-testid="map-editor-trace-fit"
                @click="
                    setTrace({
                        x: 0,
                        y: 0,
                        width: state.map.width,
                    })
                "
            >
                {{ $t('mapEditor.traceFit') }}
            </UButton>
        </template>
    </div>
</template>

<script setup lang="ts">
import type { MapTrace } from '#shared/utils/mapGeometry'
import { canResize, TRACE_TYPES } from '~/utils/mapEditor'

const props = defineProps<{
    editor: ReturnType<typeof useMapEditor>
    hasTrace: boolean
}>()

const emit = defineEmits<{
    uploadTrace: [file: File]
    removeTrace: []
}>()

const { t } = useI18n()
const editor = props.editor
const state = computed(() => editor.state.value)
const traceFile = ref<File | null>(null)

watch(traceFile, (file) => {
    if (!file) return
    emit('uploadTrace', file)
    traceFile.value = null
})

const width = ref(state.value.map.width)
const height = ref(state.value.map.height)
const resizeError = ref(false)

watch(
    () => [state.value.map.width, state.value.map.height],
    ([nextWidth, nextHeight]) => {
        width.value = nextWidth!
        height.value = nextHeight!
    },
)

const traceFields = computed(() => [
    { key: 'x' as const, label: 'X' },
    { key: 'y' as const, label: 'Y' },
    { key: 'width' as const, label: t('mapEditor.width') },
])

function resize() {
    const nextWidth = Number(width.value)
    const nextHeight = Number(height.value)
    resizeError.value = !canResize(state.value, nextWidth, nextHeight)
    if (resizeError.value) return
    editor.commit({
        ...state.value,
        map: { ...state.value.map, width: nextWidth, height: nextHeight },
    })
}

function setTrace(patch: Partial<MapTrace>) {
    const trace = state.value.map.trace
    if (!trace) return
    editor.commit({
        ...state.value,
        map: { ...state.value.map, trace: { ...trace, ...patch } },
    })
}

function previewOpacity(opacity: number | undefined) {
    const trace = state.value.map.trace
    if (!trace || opacity === undefined) return
    if (!editor.inGesture()) editor.beginGesture()
    editor.preview({
        ...state.value,
        map: { ...state.value.map, trace: { ...trace, opacity } },
    })
}

function setTraceNumber(
    key: 'x' | 'y' | 'width',
    value: number | null | undefined,
) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    if (key === 'width' && value <= 0) return
    if (state.value.map.trace?.[key] === value) return
    setTrace({ [key]: value })
}
</script>
