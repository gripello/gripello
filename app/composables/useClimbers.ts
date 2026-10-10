import type { Ref } from 'vue'
import { fileUrl } from '~/api/client'
import type { Climber } from '~/utils/friends'
import { listClimbersByIds } from '~/api/social'

export function useClimbers(ids: Ref<string[]>) {
    const key = computed(() => [...new Set(ids.value)].sort().join(','))
    const request = useAsyncData(
        () => `climbers:${key.value}`,
        () =>
            key.value
                ? listClimbersByIds(key.value.split(','))
                : Promise.resolve([]),
    )
    const previous = shallowRef<Climber[]>([])
    watch(
        request.data,
        (value) => {
            if (value) previous.value = value
        },
        { immediate: true },
    )
    const byId = computed(
        () =>
            new Map(
                (request.data.value ?? previous.value).map((climber) => [
                    climber.id,
                    climber,
                ]),
            ),
    )
    return { ready: Promise.resolve(request).then(() => undefined), byId }
}

export function climberFileUrl(
    id: string,
    file: string | null | undefined,
    thumb: string,
) {
    return file ? fileUrl('users', { id }, file, { thumb }) : null
}
