import type { Ref } from 'vue'
import type { RoleRecord } from '~/types/models'
import { listRoles } from '~/api/members'

export function useRoles(gymId: Readonly<Ref<string>> = useCurrentGymId()) {
    return useAsyncData<RoleRecord[]>(
        'roles',
        () => (gymId.value ? listRoles(gymId.value) : Promise.resolve([])),
        { default: () => [], watch: [gymId] },
    )
}
