import { coalesce } from '~/utils/realtimeCache'
import { subscribeRealtime } from '~/composables/useRealtime'

export default defineNuxtPlugin(() => {
    const { scope, refresh } = useModerationSummary()
    const refreshSoon = coalesce(refresh)
    let unsubscribe: (() => void) | undefined

    // Counts only exist client-side, so they load after hydration to match the server render.
    onNuxtReady(() =>
        watch(
            scope,
            async (next) => {
                unsubscribe?.()
                unsubscribe = undefined
                await refresh()
                if (next)
                    unsubscribe = subscribeRealtime(
                        `moderation:${next}`,
                        refreshSoon,
                    )
            },
            { immediate: true },
        ),
    )
})
