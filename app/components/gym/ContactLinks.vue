<template>
    <ul class="flex flex-col gap-2">
        <li v-for="link in links" :key="link.key" class="min-w-0">
            <ULink
                :href="link.href"
                :target="link.key === 'website' ? '_blank' : undefined"
                rel="noopener"
                class="flex min-w-0 items-center gap-2 text-default hover:text-primary"
                :data-testid="`${testIdPrefix}-${link.key}`"
            >
                <UIcon :name="link.icon" class="size-5 shrink-0 text-primary" />
                <span class="truncate">{{ link.label }}</span>
            </ULink>
        </li>
    </ul>
</template>

<script setup lang="ts">
defineProps<{
    links: { key: string; icon: string; label: string; href: string }[]
    testIdPrefix: string
}>()
</script>
