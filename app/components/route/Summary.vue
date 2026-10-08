<template>
    <div class="flex min-w-0 items-center" :class="small ? 'gap-2' : 'gap-3'">
        <RouteColorDot :color="route?.color" :size="DOT_SIZES[size]" :ticked />
        <div class="min-w-0 flex-1">
            <p
                class="flex min-w-0 items-center gap-1 text-highlighted"
                :class="small ? 'text-sm' : 'font-medium'"
            >
                <NuxtLink
                    v-if="to"
                    :to="to"
                    class="min-w-0 truncate hover:underline"
                >
                    {{ route?.name }}
                </NuxtLink>
                <span v-else class="min-w-0 truncate">{{ route?.name }}</span>
                <slot name="markers" />
            </p>
            <p v-if="meta || $slots.meta" class="truncate text-xs text-muted">
                <slot name="meta">{{ meta }}</slot>
            </p>
        </div>
        <GradeLabel
            v-if="!hideGrade && route"
            :source="route"
            class="shrink-0"
            :class="small ? 'text-xs' : 'text-sm'"
        />
    </div>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { GradeSource } from '#shared/utils/grades'

const DOT_SIZES = { sm: 16, md: 28, lg: 36 }

const props = withDefaults(
    defineProps<{
        route:
            | (GradeSource & {
                  name?: string
                  color?: string | null
                  type?: string | null
              })
            | null
            | undefined
        size?: 'sm' | 'md' | 'lg'
        meta?: string
        ticked?: boolean
        to?: RouteLocationRaw
        hideGrade?: boolean
    }>(),
    { size: 'md', meta: undefined, to: undefined },
)

const small = computed(() => props.size === 'sm')
</script>
