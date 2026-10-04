<template>
    <div class="users-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('users.title')">
            <template #actions>
                <UButton
                    v-if="activeTab === 'members'"
                    color="primary"
                    icon="i-lucide-user-plus"
                    data-testid="member-invite-open"
                    @click="membersCard?.openInvite()"
                >
                    {{ t('members.invite') }}
                </UButton>
                <UButton
                    v-else
                    color="primary"
                    icon="i-lucide-shield-plus"
                    data-testid="role-create-open"
                    @click="rolesEditor?.startCreate()"
                >
                    {{ t('permissions.addRole') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <UTabs
            v-model="activeTab"
            :items="tabs"
            variant="link"
            class="w-full"
            data-testid="users-tabs"
        >
            <template #members>
                <AdminMembersCard
                    ref="membersCard"
                    class="mt-4"
                    :gym-id="gymId"
                />
            </template>
            <template #roles>
                <AdminRolePermissionsEditor ref="rolesEditor" class="mt-4" />
            </template>
        </UTabs>
    </div>
</template>

<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import {
    adminUsersTabFromHash,
    adminUsersTabHash,
    type AdminUsersTab,
} from '~/utils/adminUsersTab'

const { t } = useI18n()
const gymId = useCurrentGymId()
const route = useRoute()
const router = useRouter()
const membersCard = useTemplateRef<{ openInvite: () => void }>('membersCard')
const rolesEditor = useTemplateRef<{ startCreate: () => void }>('rolesEditor')

const activeTab = ref<AdminUsersTab>('members')
const tabs = computed<TabsItem[]>(() => [
    {
        value: 'members',
        slot: 'members',
        label: t('members.title'),
        icon: 'i-lucide-users-round',
    },
    {
        value: 'roles',
        slot: 'roles',
        label: t('permissions.title'),
        icon: 'i-lucide-shield-user',
    },
])

onMounted(() => {
    watch(
        () => route.hash,
        (hash) => (activeTab.value = adminUsersTabFromHash(hash)),
        { immediate: true },
    )
    watch(activeTab, (tab) => {
        const hash = adminUsersTabHash(tab)
        if (hash !== route.hash)
            void router.replace({ query: route.query, hash })
    })
})

useHead({
    title: t('page.title.users'),
    meta: [{ name: 'description', content: t('page.content.users') }],
})

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_users',
})
</script>
