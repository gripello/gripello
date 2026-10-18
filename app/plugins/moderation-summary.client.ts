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
                if (!next) return
                const stops = [
                    subscribeRealtime(`moderation:${next}`, refreshSoon),
                ]
                // the platform badges also count suspended climbers
                if (next === 'platform')
                    stops.push(
                        subscribeRealtime(
                            'platform',
                            (event: { kind?: string; changed?: string[] }) => {
                                if (
                                    event.kind === 'platform_users.changed' &&
                                    event.changed?.includes('suspended_until')
                                )
                                    refreshSoon()
                            },
                        ),
                    )
                unsubscribe = () => stops.forEach((stop) => stop())
            },
            { immediate: true },
        ),
    )
})
