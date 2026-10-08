<template>
    <section v-if="invites?.length" class="mb-4" data-testid="pending-invites">
        <LayoutEyebrow>{{ t('invites.pending') }}</LayoutEyebrow>
        <LayoutListGroup>
            <li
                v-for="invite in invites"
                :key="invite.id"
                class="flex items-center gap-2 px-4 py-3"
                :data-testid="`pending-invite-${invite.email}`"
            >
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                        {{ invite.email }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ invite.expand?.role?.name }} ·
                        {{
                            t('invites.expires', {
                                date: formatDate(invite.expires_at, {
                                    locale,
                                }),
                            })
                        }}
                    </p>
                </div>
                <UTooltip :text="t('invites.resend')">
                    <UButton
                        icon="i-lucide-send"
                        color="neutral"
                        variant="ghost"
                        class="icon-btn"
                        :loading="busy === invite.id"
                        :aria-label="t('invites.resend')"
                        data-testid="pending-invite-resend"
                        @click="resend(invite)"
                    />
                </UTooltip>
                <UTooltip :text="t('invites.revoke')">
                    <UButton
                        icon="i-lucide-x"
                        color="error"
                        variant="ghost"
                        class="icon-btn"
                        :disabled="busy === invite.id"
                        :aria-label="t('invites.revoke')"
                        data-testid="pending-invite-revoke"
                        @click="revoke(invite)"
                    />
                </UTooltip>
            </li>
        </LayoutListGroup>
    </section>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import type { InviteRecord } from '~/types/models'

const props = defineProps<{ gymId: string }>()

const { t, locale } = useI18n()
const pb = usePocketbase()
const { run } = useAsyncAction()
const busy = ref<string | null>(null)

const { data: invites, refresh } = useAsyncData(
    `admin-invites-${props.gymId}`,
    () =>
        pb.collection('invites').getFullList<InviteRecord>({
            filter: pb.filter('gym = {:gym}', { gym: props.gymId }),
            sort: 'email',
            expand: 'role',
            requestKey: null,
        }),
)

async function withBusy(
    invite: InviteRecord,
    action: () => Promise<unknown>,
    success: string,
) {
    busy.value = invite.id
    await run(
        async () => {
            await action()
            await refresh()
        },
        { success, error: t('notifications.error.generic') },
    )
    busy.value = null
}

const resend = (invite: InviteRecord) =>
    withBusy(
        invite,
        () =>
            pb.send(`/api/gyms/${props.gymId}/members`, {
                method: 'POST',
                body: {
                    email: invite.email,
                    role: invite.role,
                    firstname: invite.firstname,
                    name: invite.name,
                },
                requestKey: null,
            }),
        t('members.invited'),
    )

const revoke = (invite: InviteRecord) =>
    withBusy(
        invite,
        () => pb.collection('invites').delete(invite.id),
        t('invites.revoked'),
    )

defineExpose({ refresh })

const { subscribe } = usePbSubscription()
onMounted(() => {
    void subscribe('invites', (e) => {
        if (e.record.gym === props.gymId) void refresh()
    })
})
</script>
