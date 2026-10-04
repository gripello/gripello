import type { GymRecord, GymStatsRecord } from '~/types/models'
import { withGymStats } from '~/utils/platformGyms'

export function usePlatformGyms() {
    const pb = usePocketbase()
    return useAsyncData(
        'platform-gyms',
        async () => {
            const [gyms, stats] = await Promise.all([
                pb.collection('gyms').getFullList<GymRecord>({
                    fields: 'id,collectionId,slug,name,unit_name,page_logo,active,created',
                    sort: 'name',
                    requestKey: null,
                }),
                pb.collection('gym_stats').getFullList<GymStatsRecord>({
                    requestKey: null,
                }),
            ])
            return withGymStats(gyms, stats)
        },
        { default: () => [] },
    )
}
