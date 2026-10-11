<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('friends.title')" />

        <LayoutEmptyState
            v-if="followsError || feedError"
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
                    @click="reloadAll"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <div
            v-else
            class="grid items-start gap-6 lg:grid-cols-3 lg:grid-rows-[auto_1fr]"
        >
            <section
                v-if="requests.length"
                class="lg:col-span-2"
                data-testid="friends-requests"
            >
                <LayoutSectionHeader :title="t('friends.tabs.requests')" />
                <ul class="grid gap-2 md:grid-cols-2">
                    <li v-for="request in requests" :key="request.id">
                        <ClimberRow
                            :id="request.follower"
                            :name="nameOf(request.follower)"
                            :avatar="byId.get(request.follower)?.avatar"
                            :test-id="`friends-person-${request.follower}`"
                            class="bg-primary/10 ring ring-primary/30"
                        >
                            <UButton
                                color="primary"
                                size="sm"
                                icon="i-lucide-check"
                                :loading="busy === request.id"
                                data-testid="friends-accept"
                                @click="accept(request.id)"
                            >
                                {{ t('friends.accept') }}
                            </UButton>
                            <UButton
                                color="neutral"
                                variant="ghost"
                                icon="i-lucide-x"
                                class="icon-btn"
                                :aria-label="t('friends.decline')"
                                data-testid="friends-decline"
                                @click="removeFollow(request.id)"
                            />
                        </ClimberRow>
                    </li>
                </ul>
            </section>

            <aside
                class="flex flex-col gap-4 lg:col-start-3 lg:row-span-2 lg:row-start-1"
            >
                <section
                    class="overflow-hidden rounded-lg bg-default ring ring-default"
                    data-testid="friends-me"
                >
                    <ClimberBanner
                        :banner="byId.get(myId)?.banner"
                        :avatar="byId.get(myId)?.avatar"
                        :name="nameOf(myId)"
                        class="h-20"
                    />
                    <div
                        class="relative -mt-10 flex flex-col items-center gap-3 px-4 pb-4 text-center"
                    >
                        <ClimberAvatar
                            :id="myId"
                            :name="nameOf(myId)"
                            :src="byId.get(myId)?.avatar"
                            size="lg"
                            class="ring-4 ring-(--ui-bg)"
                        />
                        <p
                            class="text-lg font-bold break-words text-highlighted"
                        >
                            {{ nameOf(myId) }}
                        </p>
                        <div class="grid w-full grid-cols-2 gap-2">
                            <button
                                v-for="list in PEOPLE_LISTS"
                                :key="list"
                                type="button"
                                class="rounded-lg px-2 py-2 transition"
                                :class="
                                    peopleList === list
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-elevated/50 hover:bg-accented/60'
                                "
                                :data-testid="`friends-count-${list}`"
                                @click="peopleList = list"
                            >
                                <LayoutStatTile
                                    :label="t(`friends.tabs.${list}`)"
                                    :value="counts[list]"
                                />
                            </button>
                        </div>
                        <UButton
                            :to="`/climber?id=${myId}`"
                            color="neutral"
                            variant="soft"
                            icon="i-lucide-id-card"
                            block
                            data-testid="friends-my-profile"
                        >
                            {{ t('friends.myProfile') }}
                        </UButton>
                    </div>
                </section>

                <section>
                    <UInput
                        v-model="search"
                        icon="i-lucide-search"
                        :placeholder="t('friends.search')"
                        :aria-label="t('friends.search')"
                        class="w-full"
                        size="lg"
                        data-testid="friends-search"
                    />
                    <template v-if="searchTerm.length >= 3">
                        <LayoutEmptyState
                            v-if="!searching && !results.length"
                            icon="i-lucide-user-search"
                            :card="false"
                            :title="t('friends.noResults')"
                            data-testid="friends-no-results"
                        />
                        <ul
                            v-else
                            class="mt-2 flex flex-col gap-2"
                            data-testid="friends-results"
                        >
                            <li v-for="climber in results" :key="climber.id">
                                <ClimberRow
                                    :id="climber.id"
                                    :name="climber.name"
                                    :avatar="climber.avatar"
                                >
                                    <ClimberFollowButton
                                        :user-id="climber.id"
                                        :state="stateOf(climber.id)"
                                        :loading="busy === climber.id"
                                        @follow="follow(climber.id)"
                                        @unfollow="unfollowTarget = $event"
                                    />
                                </ClimberRow>
                            </li>
                        </ul>
                    </template>
                </section>

                <section data-testid="friends-people">
                    <LayoutSectionHeader
                        :title="t(`friends.tabs.${peopleList}`)"
                    />
                    <LayoutEmptyState
                        v-if="!people.length"
                        icon="i-lucide-users"
                        :title="t(`friends.empty.${peopleList}`)"
                        :data-testid="`friends-${peopleList}-empty`"
                    />
                    <ul v-else class="flex flex-col gap-2">
                        <li
                            v-for="person in shownPeople"
                            :key="person.follow.id"
                        >
                            <ClimberRow
                                :id="person.user"
                                :name="nameOf(person.user)"
                                :avatar="byId.get(person.user)?.avatar"
                                :test-id="`friends-person-${person.user}`"
                            >
                                <UButton
                                    v-if="peopleList === 'followers'"
                                    color="neutral"
                                    variant="ghost"
                                    icon="i-lucide-user-minus"
                                    class="icon-btn"
                                    :aria-label="t('friends.removeFollower')"
                                    data-testid="friends-remove-follower"
                                    @click="removeTarget = person.follow.id"
                                />
                                <ClimberFollowButton
                                    v-else
                                    :user-id="person.user"
                                    :state="stateOf(person.user)"
                                    @unfollow="unfollowTarget = $event"
                                />
                            </ClimberRow>
                        </li>
                    </ul>
                    <UButton
                        v-if="people.length > PEOPLE_PREVIEW && !allPeople"
                        color="neutral"
                        variant="link"
                        class="mt-1"
                        @click="allPeople = true"
                    >
                        {{ t('actions.load_more') }}
                    </UButton>
                </section>
            </aside>

            <section class="lg:col-span-2" data-testid="friends-feed">
                <LayoutSectionHeader :title="t('friends.tabs.feed')" />
                <LayoutLoadingState v-if="feedLoading && !feed.length" />
                <LayoutEmptyState
                    v-else-if="!feed.length"
                    icon="i-lucide-users"
                    :title="t('friends.feedEmpty')"
                    data-testid="friends-feed-empty"
                />
                <FeedActivity v-else :ticks="feed" :climbers="byId" />
                <div v-if="feedHasMore" class="mt-4 flex justify-center">
                    <UButton
                        color="neutral"
                        variant="soft"
                        :loading="feedLoadingMore"
                        data-testid="friends-feed-more"
                        @click="loadMoreFeed"
                    >
                        {{ t('actions.load_more') }}
                    </UButton>
                </div>
            </section>
        </div>

        <ConfirmDialog
            :model-value="!!unfollowTarget"
            :title="t('friends.unfollow')"
            :message="t('friends.unfollowConfirm')"
            :confirm-text="t('friends.unfollow')"
            @update:model-value="unfollowTarget = null"
            @confirm="confirmRemove(unfollowTarget)"
        />
        <ConfirmDialog
            :model-value="!!removeTarget"
            :title="t('friends.removeFollower')"
            :message="t('friends.removeFollowerConfirm')"
            :confirm-text="t('friends.removeFollower')"
            @update:model-value="removeTarget = null"
            @confirm="confirmRemove(removeTarget)"
        />
    </div>
</template>

<script setup lang="ts">
import { searchClimbers } from '~/api/social'
import { listFeed } from '~/api/ticks'
import type { FollowRecord } from '~/types/models'
import type { FeedTick } from '~/utils/friends'
import { cacheKeys } from '~/utils/realtimeCache'

const PEOPLE_LISTS = ['following', 'followers'] as const
const PEOPLE_PREVIEW = 8

definePageMeta({ middleware: ['auth'] })

const { t } = useI18n()
const { error: notifyError } = useNotification()
const myId = useAuthRecord().value?.id ?? ''

useHead({ title: t('page.title.friends') })

const {
    ready,
    error: followsError,
    refresh: refreshFollows,
    following,
    requested,
    followers,
    requests,
    stateOf,
    follow: createFollow,
    remove,
    accept: acceptFollow,
} = useFollows()
await ready

const {
    items: feed,
    totalItems: feedTotal,
    loading: feedLoading,
    loadingMore: feedLoadingMore,
    hasMore: feedHasMore,
    error: feedError,
    refresh: refreshFeed,
    reloadLoaded: reloadFeed,
    loadMore: loadMoreFeed,
} = usePbList<FeedTick>(
    (page, limit) =>
        listFeed({ page, limit, total: true }, { requestKey: 'friendsFeed' }),
    { perPage: 60, requestKey: 'friendsFeed' },
)
const { data: feedPage } = await useAsyncData(
    cacheKeys.friendsFeed,
    async () => {
        await reloadFeed()
        return { items: feed.value, totalItems: feedTotal.value }
    },
)
watch(
    feedPage,
    (page) => {
        if (!page) return
        feed.value = page.items
        feedTotal.value = page.totalItems
    },
    { immediate: true },
)

const peopleList = ref<(typeof PEOPLE_LISTS)[number]>('following')
const allPeople = ref(false)
watch(peopleList, () => (allPeople.value = false))
const people = computed(() =>
    (peopleList.value === 'following'
        ? [...following.value, ...requested.value]
        : followers.value
    ).map((follow: FollowRecord) => ({
        follow,
        user: follow.follower === myId ? follow.followee : follow.follower,
    })),
)
const shownPeople = computed(() =>
    allPeople.value ? people.value : people.value.slice(0, PEOPLE_PREVIEW),
)
const counts = computed(() => ({
    following: following.value.length,
    followers: followers.value.length,
}))

const search = ref('')
const searchTerm = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => (searchTerm.value = value.trim()), 300)
})
const { data: searchResults, status: searchStatus } = useAsyncData(
    'friends-search',
    () =>
        searchTerm.value.length >= 3
            ? searchClimbers(searchTerm.value)
            : Promise.resolve([]),
    { server: false, watch: [searchTerm], default: () => [] },
)
const results = computed(() => searchResults.value)
const searching = computed(() => searchStatus.value === 'pending')

const knownIds = computed(() => [
    myId,
    ...feed.value.map((tick) => tick.user),
    ...[
        ...following.value,
        ...requested.value,
        ...followers.value,
        ...requests.value,
    ].map((follow) =>
        follow.follower === myId ? follow.followee : follow.follower,
    ),
])
const { ready: climbersReady, byId } = useClimbers(knownIds)
await climbersReady
const nameOf = (userId: string) =>
    byId.value.get(userId)?.name || t('leaderboard.anonymous')

const busy = ref('')
const unfollowTarget = ref<string | null>(null)
const removeTarget = ref<string | null>(null)

async function act(id: string, action: () => Promise<unknown>) {
    busy.value = id
    try {
        await action()
    } catch (error) {
        console.error(error)
        notifyError(t('notifications.error.generic'))
    } finally {
        busy.value = ''
    }
}

const follow = (userId: string) => act(userId, () => createFollow(userId))
const accept = (followId: string) => act(followId, () => acceptFollow(followId))
const removeFollow = (followId: string) => act(followId, () => remove(followId))

async function confirmRemove(followId: string | null) {
    unfollowTarget.value = null
    removeTarget.value = null
    if (!followId) return
    await removeFollow(followId)
    await refreshFeed()
}

function reloadAll() {
    void refreshFollows()
    void refreshFeed()
}

onBeforeUnmount(() => clearTimeout(searchDebounce))
</script>
