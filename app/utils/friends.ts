import type {
    FollowRecord,
    FriendTickRecord,
    RouteRecord,
} from '~/types/models'

export interface Climber {
    id: string
    name: string
    avatar: string
    banner?: string
}

export interface ClimberProfile extends Climber {
    closed: boolean
    private: boolean
    followers: number
    following: number
    follow: { id: string; status: FollowRecord['status'] } | null
    sends_visible: boolean
}

export type FollowState =
    | { kind: 'self' }
    | { kind: 'none' }
    | { kind: 'requested' | 'following'; id: string }

export function followState(
    follows: FollowRecord[],
    myId: string,
    userId: string,
): FollowState {
    if (userId === myId) return { kind: 'self' }
    const outgoing = follows.find(
        (follow) => follow.follower === myId && follow.followee === userId,
    )
    if (!outgoing) return { kind: 'none' }
    return {
        kind: outgoing.status === 'accepted' ? 'following' : 'requested',
        id: outgoing.id,
    }
}

export type FeedTick = FriendTickRecord & { expand?: { route?: RouteRecord } }
