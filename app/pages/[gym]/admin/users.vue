<template>
    <div class="users-page mx-auto w-full p-4">
        <LayoutPageHeader :title="t('members.title')">
            <template #actions>
                <UButton
                    color="primary"
                    icon="i-lucide-user-plus"
                    data-testid="member-invite-open"
                    @click="membersCard?.openInvite()"
                >
                    {{ t('members.invite') }}
                </UButton>
            </template>
        </LayoutPageHeader>

        <AdminMembersCard ref="membersCard" :gym-id="gymId" />

        <USeparator class="my-8" />

        <div id="roles" class="scroll-anchor">
            <AdminRolePermissionsEditor />
        </div>
    </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const gymId = useCurrentGymId()
const membersCard = useTemplateRef<{ openInvite: () => void }>('membersCard')

useHead({
    title: t('page.title.users'),
    meta: [{ name: 'description', content: t('page.content.users') }],
})

definePageMeta({
    middleware: ['auth'],
    requiredPermission: 'manage_users',
})
</script>
