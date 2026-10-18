import { getGym } from '~/api/gyms'
import type { GymEvent } from '~/composables/useRealtime'
import type { GymRecord } from '~/types/models'

export function updatedGym(
    current: GymRecord | null | undefined,
    event: GymEvent,
) {
    return event.kind === 'gym.updated' && event.record.id === current?.id
        ? event.record
        : null
}

// For pages without the default layout, which keeps the gym live for every other page.
export function useLiveGym() {
    const { gym, slug } = useGym()
    useRealtime(
        () => gym.value?.id && `gym:${gym.value.id}`,
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
