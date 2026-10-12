<template>
    <span
        class="flex min-w-0 items-center gap-3"
        :data-testid="`member-card-${member.user}`"
    >
        <ClimberAvatar :src="member.avatarUrl" :name="member.displayName" />
        <span class="block min-w-0 flex-1">
            <span
                class="block truncate text-sm font-semibold text-highlighted"
                data-testid="member-card-name"
            >
                {{ member.displayName }}
            </span>
            <span class="block truncate text-xs text-muted">
                {{ member.email }}
            </span>
        </span>
    </span>
</template>

<script setup lang="ts">
defineProps<{
    member: {
        user: string
        displayName: string
        email: string
        initials: string
        avatarUrl: string | null
    }
}>()
</script>
