<template>
    <UButton
        v-if="state.kind === 'none'"
        color="primary"
        size="sm"
        icon="i-lucide-user-plus"
        :loading="loading"
        :data-testid="`follow-${userId}`"
        @click="emit('follow')"
    >
        {{ t('friends.follow') }}
    </UButton>
    <UButton
        v-else-if="state.kind !== 'self'"
        color="neutral"
        variant="soft"
        size="sm"
        :icon="
            state.kind === 'following'
                ? 'i-lucide-user-check'
                : 'i-lucide-clock'
        "
        :loading="loading"
        :data-testid="`unfollow-${userId}`"
        @click="emit('unfollow', state.id)"
    >
        {{
            state.kind === 'following'
                ? t('friends.following')
                : t('friends.requested')
        }}
    </UButton>
</template>

<script setup lang="ts">
import type { FollowState } from '~/utils/friends'

defineProps<{ userId: string; state: FollowState; loading?: boolean }>()
const emit = defineEmits<{ follow: []; unfollow: [followId: string] }>()
const { t } = useI18n()
</script>
