import type { TickRecord } from '~/types/models'

export const ALL_GYMS = 'all'

type GymTick = Pick<TickRecord, 'expand'>

export function gymsInTicks(ticks: GymTick[]) {
    const gyms = new Map<string, string>()
    for (const tick of ticks) {
        const gym = tick.expand?.route?.expand?.gym
        if (gym) gyms.set(gym.id, gym.name)
    }
    return [...gyms]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

export function ticksInGym<T extends GymTick>(ticks: T[], gymId: string) {
    if (gymId === ALL_GYMS) return ticks
    return ticks.filter((tick) => tick.expand?.route?.gym === gymId)
}
