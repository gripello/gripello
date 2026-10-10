import { listGyms } from '~/api/gyms'
import { getPlatformStats } from '~/api/platform'
import { withGymStats } from '~/utils/platformGyms'

export function usePlatformGyms() {
    return useAsyncData(
        'platform-gyms',
        async () => {
            const [gyms, stats] = await Promise.all([
                listGyms({ all: true }),
                getPlatformStats(),
            ])
            return withGymStats(gyms, stats.gyms)
        },
        { default: () => [] },
    )
}
