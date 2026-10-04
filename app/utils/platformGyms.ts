import type { GymRecord, GymStatsRecord } from '~/types/models'

export type PlatformGym = GymRecord & { members: number; routes: number }

export function withGymStats(
    gyms: GymRecord[],
    stats: GymStatsRecord[],
): PlatformGym[] {
    const byId = new Map(stats.map((entry) => [entry.id, entry]))
    return gyms.map((gym) => ({
        ...gym,
        members: byId.get(gym.id)?.members ?? 0,
        routes: byId.get(gym.id)?.routes ?? 0,
    }))
}

export function platformTotals(gyms: PlatformGym[]) {
    return {
        gyms: gyms.length,
        activeGyms: gyms.filter((gym) => gym.active).length,
        members: gyms.reduce((sum, gym) => sum + gym.members, 0),
        routes: gyms.reduce((sum, gym) => sum + gym.routes, 0),
    }
}
