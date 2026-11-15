import { gymTopic } from '#shared/utils/topics'
import { getGym } from '~/api/gyms'
import type { GymEvent } from '~/composables/useRealtime'
import type { GymRecord } from '~/types/models'

export function updatedGym(
    current: GymRecord | null | undefined,
    event: GymEvent,
) {
    if (event.kind === 'gym.trial_changed')
        return event.gym === current?.id
            ? { ...current, trial_ends_at: event.trial_ends_at }
            : null
    if (event.kind !== 'gym.updated' || event.record.id !== current?.id)
        return null
    // gym.updated goes out without the trial end (members get it as gym.trial_changed) and the staff-only report address.
    const kept: Partial<GymRecord> = {}
    if (current.trial_ends_at) kept.trial_ends_at = current.trial_ends_at
    if (current.report_email !== undefined)
        kept.report_email = current.report_email
    return Object.keys(kept).length
        ? { ...event.record, ...kept }
        : event.record
}

// For pages without the default layout, which keeps the gym live for every other page.
export function useLiveGym() {
    const { gym, slug } = useGym()
    useRealtime(
        () => gym.value?.id && gymTopic(gym.value.id),
        (event: GymEvent) => {
            const next = updatedGym(gym.value, event)
            if (next) gym.value = next
        },
        {
            resync: async () => {
                const next = await getGym(slug.value).catch(() => null)
                if (next) gym.value = next
            },
        },
    )
}
