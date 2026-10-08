<template>
    <LayoutEmptyState
        v-if="push.loadError.value"
        variant="error"
        :title="t('errors.loadFailed')"
        data-testid="load-error"
    >
        <template #actions>
            <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-refresh-cw"
                data-testid="load-error-retry"
                @click="push.refresh()"
            >
                {{ t('errors.retry') }}
            </UButton>
        </template>
    </LayoutEmptyState>
    <div v-else class="flex flex-col gap-6">
        <section v-if="topics.length" class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.topicsTitle') }}
            </LayoutEyebrow>
            <UPageCard variant="outline" :ui="{ container: LIST }">
                <label
                    v-for="topic in topics"
                    :key="topic.key"
                    class="flex cursor-pointer items-center gap-3 px-4 py-3"
                >
                    <span class="push-icon bg-elevated text-muted">
                        <UIcon :name="topic.icon" class="size-4" />
                    </span>
                    <span class="flex-1 text-sm font-medium text-highlighted">
                        {{ t(`accountSettings.push.topics.${topic.key}`) }}
                    </span>
                    <USwitch
                        :model-value="isTopicEnabled(prefs, 'push', topic.key)"
                        :data-testid="`push-topic-${topic.key}`"
                        @update:model-value="setTopic(topic.key, $event)"
                    />
                </label>
            </UPageCard>
        </section>

        <section class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.devices') }}
            </LayoutEyebrow>
            <UPageCard
                variant="outline"
                :ui="{ container: LIST }"
                data-testid="push-devices"
            >
                <div
                    v-for="device in push.devices.value"
                    :key="device.id"
                    class="flex items-center gap-3 py-1 ps-4 pe-1"
                    data-testid="push-device"
                >
                    <span class="push-icon bg-primary/10 text-primary">
                        <UIcon
                            :name="
                                isMobileDevice(device.device ?? '')
                                    ? 'i-lucide-smartphone'
                                    : 'i-lucide-monitor'
                            "
                            class="size-4"
                        />
                    </span>
                    <div class="min-w-0 flex-1">
                        <p
                            class="flex items-center gap-2 text-sm font-medium text-highlighted"
                        >
                            <span class="truncate">
                                {{
                                    device.device ||
                                    t('accountSettings.push.unknownDevice')
                                }}
                            </span>
                            <UBadge
                                v-if="
                                    device.endpoint ===
                                    push.currentEndpoint.value
                                "
                                :label="t('accountSettings.push.thisDevice')"
                                variant="subtle"
                                size="sm"
                            />
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{
                                formatDate(device.created, {
                                    locale,
                                    dateStyle: 'medium',
                                })
                            }}
                        </p>
                    </div>
                    <UButton
                        v-if="device.endpoint === push.currentEndpoint.value"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-send"
                        class="icon-btn"
                        :aria-label="t('accountSettings.push.sendTest')"
                        :loading="testPush.pending.value"
                        data-testid="push-send-test"
                        @click="sendTest"
                    />
                    <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        class="icon-btn"
                        :aria-label="
                            t('accountSettings.push.removeDevice', {
                                device: device.device,
                            })
                        "
                        :disabled="push.busy.value"
                        @click="removeDevice(device)"
                    />
                </div>

                <div
                    v-if="!push.thisDeviceAdded.value"
                    class="flex items-center gap-3 px-4 py-3"
                >
                    <span class="push-icon bg-elevated text-muted">
                        <UIcon name="i-lucide-bell-plus" class="size-4" />
                    </span>
                    <span
                        v-if="!push.available.value"
                        class="flex-1 text-sm text-muted"
                        data-testid="push-unavailable"
                    >
                        {{
                            push.support.value === 'install'
                                ? t('accountSettings.push.install')
                                : t('accountSettings.push.unsupported')
                        }}
                    </span>
                    <template v-else>
                        <span
                            class="flex-1 text-sm font-medium text-highlighted"
                        >
                            {{ t('accountSettings.push.thisDevice') }}
                        </span>
                        <UButton
                            color="primary"
                            variant="soft"
                            :loading="push.busy.value"
                            data-testid="push-add-device"
                            @click="addThisDevice"
                        >
                            {{ t('accountSettings.push.addDevice') }}
                        </UButton>
                    </template>
                </div>
            </UPageCard>
        </section>

        <section v-if="followedWalls.length" class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.followedWalls') }}
            </LayoutEyebrow>
            <UPageCard
                variant="outline"
                :ui="{ container: LIST }"
                data-testid="push-followed-walls"
            >
                <div
                    v-for="wall in followedWalls"
                    :key="wall.id"
                    class="flex items-center gap-3 py-1 ps-4 pe-1"
                >
                    <span class="push-icon bg-primary/10 text-primary">
                        <UIcon name="i-lucide-mountain" class="size-4" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <p
                            class="truncate text-sm font-medium text-highlighted"
                        >
                            {{ wall.name }}
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{ wall.expand?.location?.name }}
                        </p>
                    </div>
                    <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        class="icon-btn"
                        :aria-label="t('map.unfollowWall', { wall: wall.name })"
                        @click="unfollow(wall.id)"
                    />
                </div>
            </UPageCard>
        </section>
    </div>
</template>

<script setup lang="ts">
import { formatDate } from '#shared/utils/formatting'
import {
    isTopicEnabled,
    visibleTopics,
    withTopic,
    type NotificationPrefs,
} from '~/utils/notificationPrefs'
import { isMobileDevice } from '~/utils/push'
import type {
    LocationRecord,
    PushSubscriptionRecord,
    UserRecord,
    WallRecord,
} from '~/types/models'

type FollowedWall = WallRecord & { expand?: { location?: LocationRecord } }

const LIST = 'p-0 sm:p-0 gap-y-0 divide-y divide-default'
const TOPIC_ICONS: Record<string, string> = {
    new_routes: 'i-lucide-sparkles',
    defect_fixed: 'i-lucide-wrench',
    wish_done: 'i-lucide-sparkles',
    competition_results: 'i-lucide-trophy',
    tasks: 'i-lucide-clipboard-list',
    reports: 'i-lucide-flag',
    platform_reports: 'i-lucide-shield-alert',
    moderation: 'i-lucide-shield-check',
    content: 'i-lucide-eye-off',
    social: 'i-lucide-users',
    achievements: 'i-lucide-medal',
}

const { t, locale } = useI18n()
const pb = usePocketbase()
const push = usePushSubscription()
const { memberships, isPlatformAdmin } = usePermissions()
const { followed, setFollowing } = useFollowedWalls()
const { error: notifyError } = useNotification()
const testPush = useAsyncAction()

const grantedPermissions = computed(
    () =>
        new Set([
            ...memberships.value.flatMap(
                (membership) =>
                    membership.expand?.role?.expand?.permissions?.map(
                        (permission) => permission.name,
                    ) ?? [],
            ),
            ...(isPlatformAdmin.value ? ['platform_admin'] : []),
        ]),
)
const topics = computed(() =>
    visibleTopics(push.topics.value, grantedPermissions.value).map((topic) => ({
        key: topic.key,
        icon: TOPIC_ICONS[topic.key] ?? 'i-lucide-bell',
    })),
)
const prefs = ref<NotificationPrefs>(
    (pb.authStore.record as UserRecord | null)?.notification_prefs ?? {},
)

async function addThisDevice() {
    try {
        if (!(await push.addThisDevice()))
            notifyError(t('accountSettings.push.blocked'))
    } catch (err) {
        console.error('Push subscription failed:', err)
        notifyError(t('notifications.error.edit'))
    }
}

function sendTest() {
    return testPush.run(() => push.sendTest(), {
        success: t('accountSettings.push.testSent'),
    })
}

async function removeDevice(device: PushSubscriptionRecord) {
    await push
        .removeDevice(device)
        .catch(() => notifyError(t('notifications.error.delete')))
}

async function setTopic(topic: string, on: boolean) {
    prefs.value = withTopic(prefs.value, 'push', topic, on)
    try {
        const updated = await pb
            .collection('users')
            .update(pb.authStore.record!.id, {
                notification_prefs: prefs.value,
            })
        pb.authStore.save(pb.authStore.token, updated)
    } catch {
        prefs.value = withTopic(prefs.value, 'push', topic, !on)
        notifyError(t('notifications.error.edit'))
    }
}

const followedWalls = ref<FollowedWall[]>([])

async function loadFollowedWalls(ids: string[]) {
    followedWalls.value = ids.length
        ? await pb
              .collection('walls')
              .getFullList<FollowedWall>({
                  filter: ids
                      .map((id) => pb.filter('id = {:id}', { id }))
                      .join(' || '),
                  expand: 'location',
                  sort: 'name',
              })
              .catch(() => [])
        : []
}

watch(followed, loadFollowedWalls)
onMounted(() => loadFollowedWalls(followed.value))

async function unfollow(wallId: string) {
    await setFollowing(wallId, false).catch(() =>
        notifyError(t('notifications.error.edit')),
    )
}
</script>

<style scoped>
@reference "~/assets/css/main.css";

.push-icon {
    @apply inline-flex size-9 shrink-0 items-center justify-center rounded-lg;
}
</style>
