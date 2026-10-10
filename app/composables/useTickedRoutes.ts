import { listSentRoutes } from '~/api/ticks'
import { cacheKeys } from '~/utils/realtimeCache'
import { isOfflineError, opsOfUser } from '~/utils/tickOutbox'

export function useTickedRoutes() {
    const authStore = useAuthStore()
    const outbox = useTickOutbox()
    const { data } = useAsyncData(
        cacheKeys.tickedRoutes,
        async () => {
            if (!authStore.isValid) return []
            return listSentRoutes().catch(async (error) =>
                isOfflineError(error)
                    ? (await outbox.cachedTicks())
                          .filter((tick) => tick.type !== 'attempt')
                          .map((tick) => tick.route ?? '')
                    : [],
            )
        },
        { default: () => [] },
    )

    return {
        tickedRouteIds: computed(
            () =>
                new Set([
                    ...data.value,
                    ...opsOfUser(
                        outbox.queue.value,
                        authStore.record?.id,
                    ).flatMap((op) =>
                        op.op === 'create' &&
                        !op.failed &&
                        op.record?.route &&
                        op.record.type !== 'attempt'
                            ? [op.record.route]
                            : [],
                    ),
                ]),
        ),
        refreshTickedRoutes: () =>
            refreshNuxtData([cacheKeys.tickedRoutes, cacheKeys.logbook]),
    }
}
