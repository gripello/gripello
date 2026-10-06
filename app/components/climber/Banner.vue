<template>
    <div class="relative overflow-hidden" data-testid="climber-banner">
        <img
            v-if="banner"
            :src="banner"
            alt=""
            class="size-full object-cover"
            data-testid="climber-banner-image"
        />
        <span
            v-else
            class="block size-full transition-[background] duration-500"
            :style="{ background: gradient }"
            :data-testid="
                palette.length
                    ? 'climber-banner-avatar'
                    : 'climber-banner-color'
            "
        />
    </div>
</template>

<script setup lang="ts">
import { avatarColor } from '~/utils/avatar'
import { paletteFromPixels, paletteGradient } from '~/utils/palette'

const props = defineProps<{
    banner?: string | null
    avatar?: string | null
    name?: string | null
}>()

const SAMPLE_SIZE = 32

const palette = ref<string[]>([])

const gradient = computed(() => {
    const fromAvatar = paletteGradient(palette.value)
    if (fromAvatar) return fromAvatar
    const color = avatarColor(props.name)
    return `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 35%, var(--ui-bg)))`
})

async function avatarPalette(src: string) {
    try {
        const blob = await (await fetch(src)).blob()
        const bitmap = await createImageBitmap(blob, {
            resizeWidth: SAMPLE_SIZE,
            resizeHeight: SAMPLE_SIZE,
        })
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = SAMPLE_SIZE
        const context = canvas.getContext('2d')
        context?.drawImage(bitmap, 0, 0)
        bitmap.close()
        const pixels = context?.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        return pixels ? paletteFromPixels(pixels.data) : []
    } catch {
        return []
    }
}

onMounted(() =>
    watch(
        () => (props.banner ? null : props.avatar),
        async (src, _, onCleanup) => {
            let stale = false
            onCleanup(() => (stale = true))
            const next = src ? await avatarPalette(src) : []
            if (!stale) palette.value = next
        },
        { immediate: true },
    ),
)
</script>
