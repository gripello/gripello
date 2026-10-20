<template>
    <img
        v-if="url"
        :src="url"
        :srcset="thumbSrcset(url, THUMB_SETS.avatar)"
        :sizes="`${PIXELS[size]}px`"
        :alt="name"
        class="shrink-0 rounded-full object-cover"
        :class="sizeClass"
    />
    <span
        v-else
        class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
        :class="sizeClass"
        :style="{ backgroundColor: avatarColor(id || name) }"
        aria-hidden="true"
    >
        {{ nameInitials(name) }}
    </span>
</template>

<script setup lang="ts">
import { THUMBS, THUMB_SETS, thumbSrcset } from '#shared/utils/thumbs'
import { avatarColor, avatarUrl, nameInitials } from '~/utils/avatar'

const props = withDefaults(
    defineProps<{
        id?: string
        name: string
        avatar?: string | null
        src?: string | null
        size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    }>(),
    { id: undefined, avatar: null, src: null, size: 'md' },
)

const LARGE_SIZES = new Set(['lg', 'xl'])
const SIZES = {
    xs: 'size-6 text-[10px]',
    sm: 'size-8 text-xs',
    md: 'size-10 text-xs',
    lg: 'size-20 text-2xl',
    xl: 'size-28 text-3xl',
}
const PIXELS = { xs: 24, sm: 32, md: 40, lg: 80, xl: 112 }
const sizeClass = computed(() => SIZES[props.size])
const url = computed(
    () =>
        props.src ||
        avatarUrl(
            { id: props.id, avatar: props.avatar },
            LARGE_SIZES.has(props.size) ? THUMBS.avatarLarge : THUMBS.avatar,
        ),
)
</script>
