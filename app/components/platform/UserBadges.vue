<template>
    <div class="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
        <UBadge
            v-if="!user.verified"
            size="sm"
            color="warning"
            variant="soft"
            icon="i-lucide-mail-warning"
            data-testid="platform-user-verified-badge"
        >
            {{ t('platform.users.unverified') }}
        </UBadge>
        <UBadge
            v-if="user.platform_admin"
            size="sm"
            color="primary"
            variant="soft"
            icon="i-lucide-shield-check"
            data-testid="platform-user-admin-badge"
        >
            {{ t('platform.users.platformAdmin') }}
        </UBadge>
        <UBadge
            v-if="isSuspended(user)"
            size="sm"
            color="error"
            variant="soft"
            icon="i-lucide-ban"
            data-testid="platform-user-suspended-badge"
        >
            {{
                isPermanentlySuspended(user)
                    ? t('platform.users.suspendedPermanently')
                    : t('platform.users.suspendedUntil', {
                          date: formatDate(user.suspended_until!, { locale }),
                      })
            }}
        </UBadge>
        <UBadge
            v-if="user.locked_until"
            size="sm"
            color="warning"
            variant="soft"
            icon="i-lucide-lock"
            data-testid="platform-user-locked-badge"
        >
            {{ t('platform.users.locked') }}
        </UBadge>
    </div>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import {
    isPermanentlySuspended,
    isSuspended,
    type PlatformUser,
} from '~/utils/platformUsers'

defineProps<{ user: PlatformUser }>()

const { t, locale } = useI18n()
</script>
