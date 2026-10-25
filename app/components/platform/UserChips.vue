<template>
    <div class="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
        <UBadge
            v-for="chip in chips"
            :key="chip.id"
            size="sm"
            color="neutral"
            variant="outline"
            class="max-w-full"
            :data-testid="`platform-user-chip-${chip.gym}`"
        >
            <span
                class="size-2 shrink-0 rounded-full"
                :class="{ 'bg-muted': !chip.roleColor }"
                :style="{ backgroundColor: chip.roleColor || undefined }"
            />
            <span class="truncate">
                {{ chip.gymTitle }} · {{ chip.roleName }}
            </span>
        </UBadge>
    </div>
</template>

<script setup lang="ts">
import type { MembershipChip } from '~/utils/platformUsers'

defineProps<{ chips: MembershipChip[] }>()
</script>
