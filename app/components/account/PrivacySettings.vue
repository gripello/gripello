<template>
    <UPageCard
        variant="outline"
        :ui="{ container: 'p-0 sm:p-0 gap-y-0 divide-y divide-default' }"
        data-testid="privacy-settings"
    >
        <div class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="privacy-icon bg-elevated text-muted">
                <UIcon name="i-lucide-user-plus" class="size-4" />
            </span>
            <span class="flex-1 text-sm font-medium text-highlighted">
                {{ t('accountSettings.privacy.followPolicy') }}
            </span>
            <USelect
                :model-value="followPolicy"
                :items="policyItems"
                class="w-full sm:w-64"
                data-testid="privacy-follow-policy"
                @update:model-value="save({ follow_policy: $event })"
            />
        </div>
        <label
            v-for="toggle in TOGGLES"
            :key="toggle.field"
            class="flex cursor-pointer items-center gap-3 px-4 py-3"
        >
            <span class="privacy-icon bg-elevated text-muted">
                <UIcon :name="toggle.icon" class="size-4" />
            </span>
            <span class="flex-1 text-sm font-medium text-highlighted">
                {{ t(`accountSettings.privacy.${toggle.label}`) }}
            </span>
            <USwitch
                :model-value="!hidden[toggle.field]"
                :data-testid="`privacy-${toggle.label}`"
                @update:model-value="save({ [toggle.field]: !$event })"
            />
        </label>
        <div
            v-for="entry in blocks"
            :key="entry.id"
            class="flex items-center gap-3 px-4 py-3"
            data-testid="privacy-blocked"
        >
            <span class="privacy-icon bg-elevated text-muted">
                <UIcon name="i-lucide-ban" class="size-4" />
            </span>
            <span class="flex-1 truncate text-sm font-medium text-highlighted">
                {{ byId.get(entry.blocked)?.name || t('feed.someone') }}
            </span>
            <UButton
                color="neutral"
                variant="soft"
                size="sm"
                data-testid="privacy-unblock"
                @click="unblock(entry.blocked)"
            >
                {{ t('friends.unblock') }}
            </UButton>
        </div>
    </UPageCard>
</template>

<script setup lang="ts">
import type { FollowPolicy, UserRecord } from '~/types/models'

type HiddenField = 'leaderboard_hidden' | 'reviews_anonymous' | 'ticks_private'
type PrivacyChange = Partial<Pick<UserRecord, 'follow_policy' | HiddenField>>

const TOGGLES: { field: HiddenField; label: string; icon: string }[] = [
    {
        field: 'leaderboard_hidden',
        label: 'leaderboard',
        icon: 'i-lucide-medal',
    },
    {
        field: 'reviews_anonymous',
        label: 'reviewName',
        icon: 'i-lucide-message-square-text',
    },
    {
        field: 'ticks_private',
        label: 'shareSends',
        icon: 'i-lucide-book-check',
    },
]

const { t } = useI18n()
const pb = usePocketbase()
const { blocks, unblock } = useBlocks()
const { byId } = useClimbers(
    computed(() => blocks.value.map((entry) => entry.blocked)),
)
const { error: notifyError } = useNotification()

const record = () => pb.authStore.record as UserRecord | null
const followPolicy = ref<FollowPolicy>(record()?.follow_policy || 'approve')
const hidden = reactive(
    Object.fromEntries(
        TOGGLES.map(({ field }) => [field, !!record()?.[field]]),
    ) as Record<HiddenField, boolean>,
)
const policyItems = computed(() =>
    (['approve', 'open', 'closed'] as const).map((value) => ({
        value,
        label: t(`accountSettings.privacy.policies.${value}`),
    })),
)

function current(): PrivacyChange {
    return { follow_policy: followPolicy.value, ...hidden }
}

function apply(change: PrivacyChange) {
    if (change.follow_policy) followPolicy.value = change.follow_policy
    for (const { field } of TOGGLES)
        if (change[field] !== undefined) hidden[field] = change[field]
}

type PrivacyField = keyof PrivacyChange
const latestSave: Partial<Record<PrivacyField, number>> = {}
let saves = 0

async function save(change: PrivacyChange) {
    const before = current()
    const keys = Object.keys(change) as PrivacyField[]
    const saveId = ++saves
    for (const key of keys) latestSave[key] = saveId
    apply(change)
    try {
        const updated = await pb
            .collection('users')
            .update(record()!.id, change, { requestKey: null })
        pb.authStore.save(pb.authStore.token, updated)
    } catch {
        apply(
            Object.fromEntries(
                keys
                    .filter((key) => latestSave[key] === saveId)
                    .map((key) => [key, before[key]]),
            ),
        )
        notifyError(t('notifications.error.edit'))
    }
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.privacy-icon {
    @apply inline-flex size-9 shrink-0 items-center justify-center rounded-lg;
}
</style>
