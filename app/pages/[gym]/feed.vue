<template>
    <div class="mx-auto w-full p-4">
        <LayoutPageHeader :title="t('feed.title')" />

        <LayoutEmptyState
            v-if="error"
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
                    @click="refresh()"
                >
                    {{ t('errors.retry') }}
                </UButton>
            </template>
        </LayoutEmptyState>

        <template v-else-if="data">
            <div class="grid items-start gap-8 lg:grid-cols-3">
                <div class="flex min-w-0 flex-col gap-8 lg:col-span-2">
                    <section v-if="visibleBetas.length" class="min-w-0">
                        <LayoutSectionHeader :title="t('beta.title')" />
                        <LayoutScrollStrip
                            class="[--beta-height:24rem]"
                            data-testid="feed-betas"
                        >
                            <figure
                                v-for="video in visibleBetas"
                                :key="video.id"
                                class="flex max-w-[85vw] shrink-0 snap-start flex-col gap-2"
                            >
                                <RouteBetaTile
                                    :video="video"
                                    :deletable="
                                        video.user === pb.authStore.record?.id
                                    "
                                    @report="reportTarget = video"
                                    @delete="deleteTarget = video"
                                />
                                <RouteSummary
                                    v-if="video.expand?.route"
                                    :route="video.expand.route"
                                    :to="
                                        gymPath(
                                            `/route?id=${video.route}#beta-${video.id}`,
                                        )
                                    "
                                    size="sm"
                                    class="w-0 min-w-full px-1"
                                />
                            </figure>
                        </LayoutScrollStrip>
                    </section>
                    <section data-testid="feed-activity">
                        <LayoutSectionHeader :title="t('feed.activity')" />
                        <LayoutEmptyState
                            v-if="!data.ticks.length"
                            icon="i-lucide-users"
                            :title="
                                signedIn
                                    ? t('friends.feedEmpty')
                                    : t('feed.signInForFriends')
                            "
                            data-testid="feed-activity-empty"
                        >
                            <template #actions>
                                <UButton
                                    color="primary"
                                    variant="soft"
                                    icon="i-lucide-user-plus"
                                    :to="signedIn ? '/friends' : '/auth/login'"
                                >
                                    {{
                                        signedIn
                                            ? t('friends.search')
                                            : t('account.login')
                                    }}
                                </UButton>
                            </template>
                        </LayoutEmptyState>
                        <FeedActivity :ticks="data.ticks" :climbers="byId" />
                    </section>
                </div>

                <aside class="lg:sticky lg:top-20" data-testid="feed-routes">
                    <LayoutSectionHeader
                        :title="
                            data.routes.length
                                ? `${t('feed.newRoutes')} (${data.routes.length})`
                                : t('feed.newRoutes')
                        "
                    />
                    <LayoutEmptyState
                        v-if="!data.routes.length"
                        icon="i-lucide-sparkles"
                        :card="false"
                        :title="t('feed.noNewRoutes')"
                    />
                    <LayoutListGroup v-else>
                        <LayoutListRow
                            v-for="route in data.routes.slice(0, ROUTE_PREVIEW)"
                            :key="route.id"
                            :to="gymPath(`/route?id=${route.id}`)"
                            data-testid="feed-route"
                        >
                            <RouteSummary
                                :route="route"
                                :meta="
                                    [wallOf(route), ago(route.created)]
                                        .filter(Boolean)
                                        .join(' · ')
                                "
                                class="flex-1"
                            />
                        </LayoutListRow>
                    </LayoutListGroup>
                    <UButton
                        v-if="data.routes.length > ROUTE_PREVIEW"
                        :to="gymPath('/routes')"
                        color="neutral"
                        variant="link"
                        trailing-icon="i-lucide-chevron-right"
                        class="mt-1"
                        data-testid="feed-all-routes"
                    >
                        {{ t('overview.allRoutes') }}
                    </UButton>
                </aside>
            </div>
        </template>

        <ReportsFormDialog
            v-if="reportTarget"
            :model-value="!!reportTarget"
            content-type="beta_video"
            :content-id="reportTarget.id"
            :content-url="
                reportContentUrl(
                    'beta_video',
                    reportTarget.id,
                    reportTarget.route,
                )
            "
            @update:model-value="reportTarget = null"
        />

        <ConfirmDialog
            :model-value="!!deleteTarget"
            :title="t('actions.confirm')"
            :message="t('beta.deleteConfirm')"
            :loading="deleting"
            @update:model-value="deleteTarget = null"
            @confirm="confirmDelete"
        />
    </div>
</template>

<script setup lang="ts">
import { timeAgo } from '#shared/utils/formatting'
import type { FeedBeta, FeedRoute } from '~/utils/feed'
import type { FeedTick } from '~/utils/friends'
import { cacheKeys } from '~/utils/realtimeCache'
import { reportContentUrl } from '~/utils/reports'

const NEW_ROUTE_DAYS = 30
const BETA_LIMIT = 20
const ROUTE_PREVIEW = 8
const SEND_LIMIT = 100

const { t, locale } = useI18n()
const pb = usePocketbase()
const gymId = useCurrentGymId()
const gymPath = useGymPath()
const signedIn = pb.authStore.isValid

useHead({ title: t('page.title.feed') })

const { data, error, refresh } = await useAsyncData(
    cacheKeys.communityFeed,
    async () => {
        const gym = gymId.value
        const since = new Date(Date.now() - NEW_ROUTE_DAYS * 86_400_000)
        const [routes, betas, ticks] = await Promise.all([
            pb.collection('routes').getFullList<FeedRoute>({
                filter: gymFilter(
                    pb,
                    gym,
                    pb.filter('archived = false && created >= {:since}', {
                        since,
                    }),
                ),
                sort: '-created',
                expand: 'wall',
                requestKey: null,
            }),
            pb.collection('beta_videos').getList<FeedBeta>(1, BETA_LIMIT, {
                filter: gymFilter(pb, gym),
                sort: '-created',
                expand: 'route',
                requestKey: null,
            }),
            signedIn
                ? pb
                      .collection('friend_ticks')
                      .getList<FeedTick>(1, SEND_LIMIT, {
                          filter: pb.filter('route.gym = {:gym}', { gym }),
                          sort: '-created',
                          expand: 'route',
                          requestKey: null,
                      })
                : { items: [] as FeedTick[] },
        ])
        return { routes, betas: betas.items, ticks: ticks.items }
    },
)

const { isBlocked } = useBlocks()
const visibleBetas = computed(() =>
    (data.value?.betas ?? []).filter((beta) => !isBlocked(beta.author?.id)),
)

const climberIds = computed(() =>
    (data.value?.ticks ?? []).map((tick) => tick.user),
)
const { byId } = useClimbers(climberIds)

const hydrated = useHydrated()
const ago = (at: string) => (hydrated.value ? timeAgo(at, t, locale.value) : '')
const wallOf = (route: FeedRoute) =>
    (route.expand as { wall?: { name?: string } } | undefined)?.wall?.name
const reportTarget = ref<FeedBeta | null>(null)

const deleteTarget = ref<FeedBeta | null>(null)
const { pending: deleting, run: runDelete } = useAsyncAction()

async function confirmDelete() {
    const video = deleteTarget.value
    if (!video) return
    await runDelete(() => pb.collection('beta_videos').delete(video.id), {
        success: t('beta.deleted'),
    })
    deleteTarget.value = null
    await refresh()
}
</script>
