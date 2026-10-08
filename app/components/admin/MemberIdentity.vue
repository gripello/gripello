<template>
    <div
        class="flex min-w-0 items-center gap-3"
        :data-testid="`member-card-${member.user}`"
    >
        <ClimberAvatar :src="member.avatarUrl" :name="member.displayName" />
        <div class="min-w-0 flex-1">
            <div
                class="truncate text-sm font-semibold text-highlighted"
                data-testid="member-card-name"
            >
                {{ member.displayName }}
            </div>
            <div class="truncate text-xs text-muted">
                {{ member.email }}
            </div>
        </div>
    </div>
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
