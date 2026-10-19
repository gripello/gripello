import type { GymRecord } from '~/types/models'

const DAY_MS = 24 * 60 * 60 * 1000
export const TRIAL_EXTENSION_DAYS = 14

export type GymTrial = { ended: boolean; daysLeft: number; endsAt: string }

export function gymTrial(
    gym: Pick<GymRecord, 'trial_ends_at'> | null | undefined,
    now = Date.now(),
): GymTrial | null {
    if (!gym?.trial_ends_at) return null
    const left = Date.parse(gym.trial_ends_at) - now
    return {
        ended: left <= 0,
        daysLeft: Math.max(0, Math.ceil(left / DAY_MS)),
        endsAt: gym.trial_ends_at,
    }
}

export function extendedTrialEnd(
    gym: Pick<GymRecord, 'trial_ends_at'>,
    now = Date.now(),
) {
    const from = Math.max(now, Date.parse(gym.trial_ends_at ?? '') || now)
    return new Date(from + TRIAL_EXTENSION_DAYS * DAY_MS).toISOString()
}
