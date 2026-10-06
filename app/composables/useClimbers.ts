import type { Ref } from 'vue'
import type { Climber } from '~/utils/friends'

export function useClimbers(ids: Ref<string[]>) {
    const pb = usePocketbase()
    const key = computed(() => [...new Set(ids.value)].sort().join(','))
    const request = useAsyncData(
        () => `climbers:${key.value}`,
        () =>
            key.value
                ? pb.send<Climber[]>('/api/climbers', {
                      query: { ids: key.value },
                      requestKey: null,
                  })
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
    return file
        ? usePbFileUrl({ id, collectionId: '_pb_users_auth_' }, file, { thumb })
        : null
}
