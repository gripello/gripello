<template>
    <LayoutLoadError
        v-if="push.loadError.value || prefsLoadFailed"
        @retry="retryLoad"
    />
    <div v-else class="flex flex-col gap-6">
        <section v-if="topics.length" class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.topicsTitle') }}
            </LayoutEyebrow>
            <LayoutListGroup>
                <LayoutListRow
                    v-for="topic in topics"
                    :key="topic.key"
                    as="label"
                    :icon="topic.icon"
                >
                    <span class="flex-1 text-sm font-medium text-highlighted">
                        {{ t(`accountSettings.push.topics.${topic.key}`) }}
                    </span>
                    <USwitch
                        :model-value="isTopicEnabled(prefs, 'push', topic.key)"
                        :data-testid="`push-topic-${topic.key}`"
                        :disabled="!prefsLoaded"
                        @update:model-value="setTopic(topic.key, $event)"
                    />
                </LayoutListRow>
            </LayoutListGroup>
        </section>

        <section class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.devices') }}
            </LayoutEyebrow>
            <LayoutListGroup data-testid="push-devices">
                <LayoutListRow
                    v-for="device in push.devices.value"
                    :key="device.id"
                    dense
                    :icon="
                        isMobileDevice(device.device ?? '')
                            ? 'i-lucide-smartphone'
                            : 'i-lucide-monitor'
                    "
                    icon-active
                    data-testid="push-device"
                >
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
                </LayoutListRow>

                <LayoutListRow
                    v-if="!push.thisDeviceAdded.value"
                    icon="i-lucide-bell-plus"
                >
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
                </LayoutListRow>
            </LayoutListGroup>
        </section>

        <section v-if="followedWalls.length" class="flex flex-col">
            <LayoutEyebrow>
                {{ t('accountSettings.push.followedWalls') }}
            </LayoutEyebrow>
            <LayoutListGroup data-testid="push-followed-walls">
                <LayoutListRow
                    v-for="wall in followedWalls"
                    :key="wall.id"
                    dense
                    icon="i-lucide-mountain"
                    icon-active
                >
                    <div class="min-w-0 flex-1">
                        <p
                            class="truncate text-sm font-medium text-highlighted"
                        >
                            {{ wall.name }}
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{ wall.location_name }}
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
                </LayoutListRow>
            </LayoutListGroup>
        </section>
    </div>
</template>

<script setup lang="ts">
import { getNotificationPrefs, putNotificationPrefs } from '~/api/notifications'
import { listWallsById } from '~/api/routes'
import { useAuthState } from '~/api/auth'
import { formatDate } from '#shared/utils/formatting'
import {
    isTopicEnabled,
    visibleTopics,
    withTopic,
    type NotificationPrefs,
} from '~/utils/notificationPrefs'
import { isMobileDevice } from '~/utils/push'
import type {
    PushSubscriptionRecord,
    UserRecord,
    WallRecord,
} from '~/types/models'

type FollowedWall = WallRecord & { location_name: string }

const TOPIC_ICONS: Record<string, string> = {
    new_routes: 'i-lucide-sparkles',
    defect_fixed: 'i-lucide-wrench',
    wish_done: 'i-lucide-sparkles',
    competition_results: 'i-lucide-trophy',
    tasks: 'i-lucide-clipboard-list',
    reports: 'i-lucide-flag',
    platform_reports: 'i-lucide-shield-alert',
    platform_issues: 'i-lucide-bug',
    moderation: 'i-lucide-shield-check',
    content: 'i-lucide-eye-off',
    social: 'i-lucide-users',
    achievements: 'i-lucide-medal',
    account: 'i-lucide-user-round',
}

const { t, locale } = useI18n()
const push = usePushSubscription()
const { memberships, isPlatformAdmin } = usePermissions()
const { followed, setFollowing } = useFollowedWalls()
const { error: notifyError } = useNotification()
const testPush = useAsyncAction()

const grantedPermissions = computed(
    () =>
        new Set([
            ...memberships.value.flatMap(
                (membership) => membership.role.permissions,
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
    useAuthState().currentUser<UserRecord>()?.notification_prefs ?? {},
)
const prefsLoaded = ref(false)
const prefsLoadFailed = ref(false)

async function loadPrefs() {
    prefsLoadFailed.value = false
    try {
        prefs.value = await getNotificationPrefs()
        prefsLoaded.value = true
    } catch {
        prefsLoadFailed.value = true
    }
}
onMounted(loadPrefs)

function retryLoad() {
    if (push.loadError.value) push.refresh()
    if (prefsLoadFailed.value) loadPrefs()
}

async function addThisDevice() {
    try {
        if (!(await push.addThisDevice()))
            notifyError(t('accountSettings.push.blocked'))
    } catch (err) {
        console.error('Push subscription failed:', err)
        notifyError(t('notifications.error.edit'))
        globalThis.reportError?.(err)
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
        await putNotificationPrefs(prefs.value)
    } catch {
        prefs.value = withTopic(prefs.value, 'push', topic, !on)
        notifyError(t('notifications.error.edit'))
    }
}

const followedWalls = ref<FollowedWall[]>([])

async function loadFollowedWalls(ids: string[]) {
    followedWalls.value = await listWallsById<FollowedWall>(ids).catch(() => [])
}

watch(followed, loadFollowedWalls)
onMounted(() => loadFollowedWalls(followed.value))

async function unfollow(wallId: string) {
    await setFollowing(wallId, false).catch(() =>
        notifyError(t('notifications.error.edit')),
    )
}
</script>
