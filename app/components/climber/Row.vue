<template>
    <div
        class="flex items-center gap-3 rounded-lg bg-elevated/50 px-3 py-2"
        :data-testid="testId"
    >
        <NuxtLink
            :to="`/climber?id=${id}`"
            class="flex min-w-0 flex-1 items-center gap-3"
        >
            <ClimberAvatar :id="id" :name="name" :src="avatar" />
            <span class="truncate font-semibold">{{ name }}</span>
        </NuxtLink>
        <slot />
    </div>
</template>

<script setup lang="ts">
defineProps<{
    id: string
    name: string
    avatar?: string | null
    testId?: string
}>()
</script>
