<template>
    <div
        class="flex min-w-0 items-center gap-3"
        :data-testid="`member-card-${member.user}`"
    >
        <img
            v-if="member.avatarUrl"
            :src="member.avatarUrl"
            :alt="member.displayName"
            class="size-10 shrink-0 rounded-full object-cover"
        />
        <span
            v-else
            class="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{ backgroundColor: avatarColor(member.displayName) }"
        >
            {{ member.initials }}
        </span>
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
import { avatarColor } from '~/utils/avatar'

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
