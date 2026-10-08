<template>
    <UDropdownMenu
        :items="menuItems"
        :content="
            collapsed
                ? { side: 'right', align: 'end', sideOffset: 8 }
                : { side: 'top', align: 'start', sideOffset: 8 }
        "
        :ui="{
            content: collapsed
                ? 'w-60'
                : 'w-(--reka-dropdown-menu-trigger-width) min-w-60',
        }"
    >
        <UButton
            color="neutral"
            variant="ghost"
            :block="!collapsed"
            :square="collapsed"
            class="data-[state=open]:bg-elevated"
            :class="collapsed ? 'mx-auto rounded-full p-0.5' : 'p-1.5'"
            data-testid="user-menu-activator"
            :aria-label="$t('nav.userMenu')"
        >
            <ClimberAvatar
                :id="user?.id"
                :name="displayName"
                :avatar="user?.avatar"
                :size="collapsed ? 'xs' : 'sm'"
            />
            <span v-if="!collapsed" class="min-w-0 flex-1 text-start">
                <span
                    class="block truncate text-sm font-medium text-highlighted"
                >
                    {{ displayName }}
                </span>
                <span class="block truncate text-xs text-muted">
                    {{ user?.email }}
                </span>
            </span>
            <UIcon
                v-if="!collapsed"
                name="i-lucide-chevrons-up-down"
                class="size-4 shrink-0 text-dimmed"
            />
        </UButton>
    </UDropdownMenu>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { avatarColor, nameInitials } from '~/utils/avatar'

defineProps<{ collapsed?: boolean }>()

const router = useRouter()
const pb = usePocketbase()
const { t } = useI18n()

// ── Auth state ────────────────────────────────────────────────────────────────

const user = computed(() => pb.authStore.record)

const image = computed(() =>
    usePbFileUrl(user.value, user.value?.avatar, { thumb: '100x100' }),
)

const displayName = computed(
    () =>
        [user.value?.firstname, user.value?.name].filter(Boolean).join(' ') ||
        user.value?.username ||
        user.value?.email ||
        t('account.unknownUser'),
)

const isLoggingOut = ref(false)

const menuItems = computed<DropdownMenuItem[][]>(() => [
    [
        {
            type: 'label',
            label: displayName.value,
            description: user.value?.email,
            avatar: {
                src: image.value || undefined,
                text: nameInitials(displayName.value),
                alt: displayName.value,
                class: 'text-white',
                style: { backgroundColor: avatarColor(user.value?.id) },
            },
        },
    ],
    [
        {
            'data-testid': 'user-menu-profile',
            label: t('account.profile'),
            icon: 'i-lucide-user-pen',
            to: '/account/settings',
        },

        {
            'data-testid': 'user-menu-activity',
            label: t('routes.activity'),
            icon: 'i-lucide-clipboard-clock',
            to: '/account/activity',
        },
    ],
    [
        {
            'data-testid': 'user-menu-logout',
            label: t('account.logout'),
            icon: 'i-lucide-log-out',
            color: 'error',
            disabled: isLoggingOut.value,
            onSelect: logout,
        },
    ],
])

// ── Actions ───────────────────────────────────────────────────────────────────

async function logout() {
    if (isLoggingOut.value) return
    try {
        isLoggingOut.value = true
        pb.authStore.clear()
        await router.push('/auth/login')
    } finally {
        isLoggingOut.value = false
    }
}
</script>
