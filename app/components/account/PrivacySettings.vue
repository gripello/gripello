<template>
    <LayoutListGroup data-testid="privacy-settings">
        <LayoutListRow icon="i-lucide-user-plus" wrap>
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
        </LayoutListRow>
        <LayoutListRow
            v-for="toggle in TOGGLES"
            :key="toggle.field"
            as="label"
            :icon="toggle.icon"
        >
            <span class="flex-1 text-sm font-medium text-highlighted">
                {{ t(`accountSettings.privacy.${toggle.label}`) }}
            </span>
            <USwitch
                :model-value="!hidden[toggle.field]"
                :data-testid="`privacy-${toggle.label}`"
                @update:model-value="save({ [toggle.field]: !$event })"
            />
        </LayoutListRow>
        <LayoutListRow
            v-for="entry in blocks"
            :key="entry.id"
            icon="i-lucide-ban"
            data-testid="privacy-blocked"
        >
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
        </LayoutListRow>
    </LayoutListGroup>
</template>

<script setup lang="ts">
import { translatedItems } from '~/utils/translatedItems'
import type { FollowPolicy, UserRecord } from '~/types/models'
import { updateMe } from '~/api/account'
import { useAuthState } from '~/api/auth'

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
const { currentUser } = useAuthState()
const { blocks, unblock } = useBlocks()
const { byId } = useClimbers(
    computed(() => blocks.value.map((entry) => entry.blocked)),
)
const { error: notifyError } = useNotification()

const record = () => currentUser<UserRecord>()
const followPolicy = ref<FollowPolicy>(record()?.follow_policy || 'approve')
const hidden = reactive(
    Object.fromEntries(
        TOGGLES.map(({ field }) => [field, !!record()?.[field]]),
    ) as Record<HiddenField, boolean>,
)
const policyItems = computed(() =>
    translatedItems(
        ['approve', 'open', 'closed'] as const,
        'accountSettings.privacy.policies',
        t,
    ),
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
        await updateMe(change)
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
