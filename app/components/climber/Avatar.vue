<template>
    <img
        v-if="url"
        :src="url"
        :alt="name"
        class="shrink-0 rounded-full object-cover"
        :class="sizeClass"
    />
    <span
        v-else
        class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
        :class="sizeClass"
        :style="{ backgroundColor: avatarColor(name) }"
        aria-hidden="true"
    >
        {{ nameInitials(name) }}
    </span>
</template>

<script setup lang="ts">
import { avatarColor, nameInitials } from '~/utils/avatar'

const props = withDefaults(
    defineProps<{
        id: string
        name: string
        avatar?: string | null
        size?: 'sm' | 'md' | 'lg' | 'xl'
    }>(),
    { avatar: null, size: 'md' },
)

const SIZES = {
    sm: 'size-8 text-xs',
    md: 'size-10 text-xs',
    lg: 'size-20 text-2xl',
    xl: 'size-28 text-3xl',
}
const sizeClass = computed(() => SIZES[props.size])
const url = computed(() =>
    usePbFileUrl(
        { id: props.id, collectionId: '_pb_users_auth_' },
        props.avatar,
        { thumb: '100x100' },
    ),
)
</script>
