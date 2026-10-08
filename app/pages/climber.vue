<template>
    <div class="mx-auto w-full p-4">
        <LayoutEmptyState
            v-if="profileError"
            variant="error"
            :title="t('errors.loadFailed')"
            data-testid="load-error"
        />

        <template v-else-if="profile">
            <header
                class="relative mb-6 overflow-hidden rounded-lg bg-default ring ring-default"
                data-testid="climber-header"
            >
                <ClimberBanner
                    :banner="bannerUrl"
                    :avatar="
                        climberFileUrl(climberId, profile.avatar, '100x100')
                    "
                    :name="profile.name"
                    :id="profile.id"
                    class="aspect-[4/1] max-h-60 w-full"
                />
                <div
                    class="relative flex flex-col gap-4 px-4 pb-4 sm:flex-row sm:items-end sm:px-6"
                >
                    <ClimberAvatar
                        :id="profile.id"
                        :name="profile.name"
                        :avatar="profile.avatar"
                        size="xl"
                        class="-mt-14 ring-4 ring-(--ui-bg) sm:-mt-16"
                    />
                    <div class="min-w-0 flex-1">
                        <h1
                            class="text-2xl font-black break-words text-highlighted sm:text-3xl"
                            data-testid="climber-name"
                        >
                            {{ profile.name || t('leaderboard.anonymous') }}
                        </h1>
                        <p
                            class="mt-1 flex flex-wrap gap-x-4 text-sm text-muted tabular-nums"
                        >
                            <span data-testid="climber-followers">{{
                                t(
                                    'friends.followerCount',
                                    { n: profile.followers },
                                    profile.followers,
                                )
                            }}</span>
                            <span>{{
                                t(
                                    'friends.followingCount',
                                    { n: profile.following },
                                    profile.following,
                                )
                            }}</span>
                        </p>
                    </div>
                    <UButton
                        v-if="isSelf"
                        to="/account/settings"
                        color="neutral"
                        variant="soft"
                        icon="i-lucide-pencil"
                        class="self-start sm:self-end"
                        data-testid="climber-edit"
                    >
                        {{ t('friends.editProfile') }}
                    </UButton>
                    <ClimberFollowButton
                        v-else-if="!profile.closed || state.kind !== 'none'"
                        class="self-start sm:self-end"
                        :user-id="profile.id"
                        :state="state"
                        :loading="busy"
                        @follow="follow"
                        @unfollow="unfollowTarget = $event"
                    />
                    <UDropdownMenu v-if="!isSelf" :items="menuItems">
                        <UButton
                            icon="i-lucide-ellipsis"
                            color="neutral"
                            variant="ghost"
                            class="icon-btn self-start sm:self-end"
                            :aria-label="t('actions.more')"
                            data-testid="climber-menu"
                        />
                    </UDropdownMenu>
                </div>
            </header>

            <LayoutEmptyState
                v-if="!canSee"
                :icon="
                    profile.closed || profile.private
                        ? 'i-lucide-lock'
                        : 'i-lucide-user-plus'
                "
                :title="lockedTitle"
                data-testid="climber-locked"
            />

            <LayoutEmptyState
                v-else-if="ticksError"
                variant="error"
                :title="t('errors.loadFailed')"
                data-testid="climber-ticks-error"
            />

            <template v-else>
                <div class="mb-4 flex flex-wrap items-center gap-2">
                    <SegmentedControl
                        v-model="kind"
                        :items="kindItems"
                        size="sm"
                        test-id="climber-kind"
                    />
                    <SegmentedControl
                        v-model="range"
                        :items="rangeItems"
                        size="sm"
                        test-id="climber-range"
                    />
                </div>

                <ul
                    class="mb-8 grid grid-cols-2 gap-3"
                    :class="isSelf ? 'md:grid-cols-4' : 'xl:grid-cols-5'"
                    data-testid="climber-compare"
                >
                    <li
                        v-for="stat in compareRows"
                        :key="stat.key"
                        class="flex flex-col gap-1 rounded-lg bg-default p-4 ring ring-default odd:last:col-span-2 xl:odd:last:col-span-1"
                        :data-testid="`compare-${stat.key}`"
                    >
                        <span
                            class="flex items-center gap-2 text-sm text-muted"
                        >
                            <UIcon :name="stat.icon" class="size-4 shrink-0" />
                            <span class="truncate">{{ stat.label }}</span>
                        </span>
                        <span
                            class="text-3xl font-black text-highlighted tabular-nums"
                        >
                            {{ stat.theirs }}
                        </span>
                        <span
                            v-if="!isSelf && stat.key !== 'both'"
                            class="text-xs text-muted tabular-nums"
                        >
                            {{ t('friends.you') }}: {{ stat.mine }}
                        </span>
                    </li>
                </ul>

                <div
                    class="mb-8 grid gap-8"
                    :class="{ 'lg:grid-cols-2': !isSelf && suggestions.length }"
                >
                    <section class="min-w-0" data-testid="climber-recent">
                        <LayoutSectionHeader :title="t('friends.recent')" />
                        <FeedActivity
                            v-if="recent.length"
                            :ticks="recent"
                            hide-user
                        />
                        <LayoutEmptyState
                            v-else
                            icon="i-lucide-history"
                            :title="t('ticks.empty')"
                        />
                    </section>

                    <section
                        v-if="!isSelf && suggestions.length"
                        class="min-w-0"
                    >
                        <LayoutSectionHeader :title="t('friends.onlyTheirs')" />
                        <LayoutListGroup data-testid="climber-suggestions">
                            <LayoutListRow
                                v-for="routeRecord in suggestions"
                                :key="routeRecord.id"
                                :to="`/route?id=${routeRecord.id}`"
                            >
                                <RouteSummary
                                    :route="routeRecord"
                                    class="flex-1"
                                />
                            </LayoutListRow>
                        </LayoutListGroup>
                    </section>
                </div>

                <section>
                    <LayoutSectionHeader :title="t('ticks.tabs.badges')" />
                    <BadgesGrid :user-id="climberId" />
                </section>
            </template>
        </template>

        <ConfirmDialog
            :model-value="!!unfollowTarget"
            :title="t('friends.unfollow')"
            :message="t('friends.unfollowConfirm')"
            :confirm-text="t('friends.unfollow')"
            @update:model-value="unfollowTarget = null"
            @confirm="unfollow"
        />
        <ConfirmDialog
            v-model="blockOpen"
            :title="t('friends.block')"
            :message="t('friends.blockConfirm')"
            :confirm-text="t('friends.block')"
            @confirm="blockClimber"
        />
        <ReportsFormDialog
            v-model="reportOpen"
            content-type="profile"
            :content-id="climberId"
            :content-url="reportContentUrl('profile', climberId)"
        />
    </div>
</template>

<script setup lang="ts">
import type { TickRecord, RouteRecord } from '~/types/models'
import {
    compareLogbooks,
    preferredKind,
    type LogbookKind,
    type LogbookRange,
} from '#shared/utils/logbook'
import type { ClimberProfile, FeedTick } from '~/utils/friends'
import { reportContentUrl } from '~/utils/reports'

definePageMeta({
    middleware: ['auth'],
    key: (route) => String(route.query.id ?? ''),
})

const LOGBOOK_RANGES: LogbookRange[] = ['30d', '12m', 'all']
const RECENT_LIMIT = 12

const { t } = useI18n()
const pb = usePocketbase()
const route = useRoute()
const { error: notifyError } = useNotification()
const climberId = String(route.query.id ?? '')
const myId = pb.authStore.record?.id ?? ''
const isSelf = climberId === myId
const bannerUrl = computed(() =>
    climberFileUrl(climberId, profile.value?.banner, '1600x400'),
)

const { data: profile, error: profileError } = await useAsyncData(
    `climber:${climberId}`,
    () =>
        pb.send<ClimberProfile>(
            `/api/climbers/${encodeURIComponent(climberId)}`,
            { requestKey: null },
        ),
)
if (!profile.value && !profileError.value)
    throw createError({ statusCode: 404, fatal: true })
if ((profileError.value as { statusCode?: number } | null)?.statusCode === 404)
    throw createError({ statusCode: 404, fatal: true })

useHead({
    title: computed(() =>
        t('page.title.climber', { name: profile.value?.name ?? '' }),
    ),
})

const { ready, stateOf, follow: createFollow, remove } = useFollows()
await ready
const state = computed(() => stateOf(climberId))
const canSee = computed(
    () =>
        isSelf || (state.value.kind === 'following' && !profile.value?.private),
)
const lockedTitle = computed(() => {
    if (profile.value?.closed) return t('friends.closedProfile')
    if (state.value.kind === 'requested') return t('friends.requestPending')
    if (state.value.kind === 'following') return t('friends.privateSends')
    return t('friends.followToSee')
})

type RoutedTick = FeedTick & { expand?: { route?: RouteRecord } }
const {
    data: theirTicks,
    error: theirTicksError,
    refresh: refreshTheirs,
} = await useAsyncData(
    `climber-ticks:${climberId}`,
    () =>
        canSee.value
            ? pb
                  .collection(isSelf ? 'ticks' : 'friend_ticks')
                  .getFullList<RoutedTick>({
                      filter: pb.filter('user = {:user}', { user: climberId }),
                      sort: '-date',
                      expand: 'route',
                      requestKey: null,
                  })
            : Promise.resolve([]),
    { default: () => [] },
)
const { data: myTicks, error: myTicksError } = await useAsyncData(
    `climber-compare-mine:${climberId}`,
    () =>
        isSelf
            ? Promise.resolve([])
            : pb.collection('ticks').getFullList<TickRecord>({
                  fields: 'id,route,type,attempts,date,grade,grade_system,grade_index',
                  requestKey: null,
              }),
    { default: () => [] },
)

const ticksError = computed(() => theirTicksError.value ?? myTicksError.value)

const kind = ref<LogbookKind>(preferredKind(theirTicks.value))
const range = ref<LogbookRange>('12m')
const kindItems = computed(() =>
    (['boulder', 'route'] as const).map((value) => ({
        value,
        label: t(`ticks.kind.${value}`),
    })),
)
const rangeItems = computed(() =>
    LOGBOOK_RANGES.map((value) => ({
        value,
        label: t(`ticks.range.${value}`),
    })),
)

const comparison = computed(() =>
    compareLogbooks(myTicks.value, theirTicks.value, kind.value, range.value),
)
const percent = (value: number | null) =>
    value === null ? '—' : `${Math.round(value * 100)}%`
const compareRows = computed(() => {
    const { mine, theirs } = comparison.value
    return [
        {
            key: 'sends',
            icon: 'i-lucide-check-check',
            label: t('ticks.stats.sends'),
            theirs: theirs.sends,
            mine: mine.sends,
        },
        {
            key: 'hardest',
            icon: 'i-lucide-mountain',
            label: t('ticks.stats.hardest'),
            theirs: theirs.hardest?.grade ?? '—',
            mine: mine.hardest?.grade ?? '—',
        },
        {
            key: 'flashRate',
            icon: 'i-lucide-zap',
            label: t('ticks.stats.flashRate'),
            theirs: percent(theirs.flashRate),
            mine: percent(mine.flashRate),
        },
        {
            key: 'sessions',
            icon: 'i-lucide-calendar-days',
            label: t('ticks.stats.sessions'),
            theirs: theirs.sessions,
            mine: mine.sessions,
        },
        ...(isSelf
            ? []
            : [
                  {
                      key: 'both',
                      icon: 'i-lucide-users',
                      label: t('friends.sentByBoth'),
                      theirs: comparison.value.both.length,
                      mine: comparison.value.both.length,
                  },
              ]),
    ]
})

const routesById = computed(
    () =>
        new Map(
            theirTicks.value
                .map((tick) => tick.expand?.route)
                .filter((record): record is RouteRecord => !!record)
                .map((record) => [record.id, record]),
        ),
)
const suggestions = computed(() =>
    comparison.value.onlyTheirs
        .map((id) => routesById.value.get(id))
        .filter((record): record is RouteRecord => !!record && !record.archived)
        .slice(0, 10),
)
const recent = computed(() => theirTicks.value.slice(0, RECENT_LIMIT))

const busy = ref(false)
const unfollowTarget = ref<string | null>(null)

const { isBlocked, block, unblock } = useBlocks()
const blockOpen = ref(false)
const reportOpen = ref(false)
const menuItems = computed(() => [
    isBlocked(climberId)
        ? {
              label: t('friends.unblock'),
              icon: 'i-lucide-shield-off',
              onSelect: () => run(() => unblock(climberId)),
          }
        : {
              label: t('friends.block'),
              icon: 'i-lucide-ban',
              onSelect: () => (blockOpen.value = true),
          },
    {
        label: t('reports.reportProfile'),
        icon: 'i-lucide-flag',
        onSelect: () => (reportOpen.value = true),
    },
])
const blockClimber = () => run(() => block(climberId))

async function run(action: () => Promise<unknown>) {
    busy.value = true
    try {
        await action()
        await refreshTheirs()
    } catch (error) {
        console.error(error)
        notifyError(t('notifications.error.generic'))
    } finally {
        busy.value = false
    }
}

const follow = () => run(() => createFollow(climberId))

async function unfollow() {
    const followId = unfollowTarget.value
    unfollowTarget.value = null
    if (followId) await run(() => remove(followId))
}
</script>
