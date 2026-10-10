import type { FollowRecord } from '~/types/models'
import { followState } from '~/utils/friends'
import {
    acceptFollow,
    createFollow,
    deleteFollow,
    listFollows,
} from '~/api/social'
import { cacheKeys } from '~/utils/realtimeCache'
import { serverDedupe } from '~/utils/asyncData'

export function useFollows() {
    const authRecord = useAuthRecord()
    const myId = computed(() => authRecord.value?.id ?? '')
    const request = useAsyncData(
        cacheKeys.follows,
        () => (myId.value ? listFollows() : Promise.resolve([])),
        { ...serverDedupe, default: () => [], watch: [myId] },
    )
    const follows = request.data
    const mine = (status: FollowRecord['status']) =>
        computed(() =>
            follows.value.filter(
                (follow) =>
                    follow.follower === myId.value && follow.status === status,
            ),
        )
    const theirs = (status: FollowRecord['status']) =>
        computed(() =>
            follows.value.filter(
                (follow) =>
                    follow.followee === myId.value && follow.status === status,
            ),
        )

    async function follow(userId: string) {
        await createFollow(userId)
        await request.refresh()
    }

    async function remove(followId: string) {
        await deleteFollow(followId)
        await request.refresh()
    }

    async function accept(followId: string) {
        await acceptFollow(followId)
        await request.refresh()
    }

    return {
        ready: Promise.resolve(request).then(() => undefined),
        follows,
        error: request.error,
        refresh: request.refresh,
        following: mine('accepted'),
        requested: mine('pending'),
        followers: theirs('accepted'),
        requests: theirs('pending'),
        stateOf: (userId: string) =>
            followState(follows.value, myId.value, userId),
        follow,
        remove,
        accept,
    }
}
