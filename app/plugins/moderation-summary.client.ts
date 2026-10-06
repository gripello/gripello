import { coalesce } from '~/utils/realtimeCache'

export default defineNuxtPlugin(() => {
    const pb = usePocketbase()
    const { scope, refresh } = useModerationSummary()
    const refreshSoon = coalesce(refresh)
    let unsubscribe: (() => Promise<void>) | null = null

    // Counts only exist client-side, so they load after hydration to match the server render.
    onNuxtReady(() =>
        watch(
            scope,
            async (next) => {
                await unsubscribe?.().catch(() => {})
                unsubscribe = null
                await refresh()
                if (next)
                    unsubscribe = await pb
                        .collection('moderation_items')
                        .subscribe('*', refreshSoon)
                        .catch(() => null)
            },
            { immediate: true },
        ),
    )
})
