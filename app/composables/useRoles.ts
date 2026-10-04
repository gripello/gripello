import type { Ref } from 'vue'
import type { RoleRecord } from '~/types/models'

export function useRoles(gymId: Readonly<Ref<string>> = useCurrentGymId()) {
    const pb = usePocketbase()

    return useAsyncData<RoleRecord[]>(
        'roles',
        () =>
            gymId.value
                ? pb.collection('roles').getFullList<RoleRecord>({
                      filter: pb.filter('gym = {:gym}', { gym: gymId.value }),
                      sort: 'name',
                      requestKey: 'rolesList',
                  })
                : Promise.resolve([]),
        { default: () => [], watch: [gymId] },
    )
}
