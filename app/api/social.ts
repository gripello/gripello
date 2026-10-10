import type {
    BlockRecord,
    FollowRecord,
    FollowStatus,
} from '../../types/models'
import type { AchievementView } from '../utils/achievements'
import type { Climber, ClimberProfile } from '../utils/friends'
import { useApi } from './client'

export interface FollowQuery {
    direction?: 'followers' | 'following'
    status?: FollowStatus
}

export function searchClimbers(q: string) {
    return useApi()<Climber[]>('/climbers', { query: { q } })
}

export function listClimbersByIds(ids: string[]) {
    return useApi()<Climber[]>('/climbers', { query: { ids: ids.join(',') } })
}

export function getClimber(id: string) {
    return useApi()<ClimberProfile>(`/climbers/${encodeURIComponent(id)}`)
}

export function listClimberAchievements(id: string) {
    return useApi()<AchievementView[]>(
        `/climbers/${encodeURIComponent(id)}/achievements`,
    )
}

export function listFollows(query: FollowQuery = {}) {
    return useApi()<FollowRecord[]>('/me/follows', { query })
}

export function createFollow(followee: string) {
    return useApi()<FollowRecord>('/follows', {
        method: 'POST',
        body: { followee },
    })
}

export function acceptFollow(id: string) {
    return useApi()<FollowRecord>(`/follows/${id}/accept`, { method: 'POST' })
}

export function deleteFollow(id: string) {
    return useApi()(`/follows/${id}`, { method: 'DELETE' })
}

export function listBlocks() {
    return useApi()<BlockRecord[]>('/me/blocks')
}

export function createBlock(blocked: string) {
    return useApi()<BlockRecord>('/blocks', {
        method: 'POST',
        body: { blocked },
    })
}

export function deleteBlock(id: string) {
    return useApi()(`/blocks/${id}`, { method: 'DELETE' })
}
