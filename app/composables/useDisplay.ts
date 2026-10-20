import { useEventListener } from '@vueuse/core'
import { BREAKPOINTS } from '#shared/utils/breakpoints'

const VIEWPORT_HINT = 'sec-ch-viewport-width'

export function useDisplay() {
    const width = useState('viewport-width', () => {
        if (import.meta.client) return 0
        useRequestEvent()?.node.res.setHeader(
            'Accept-CH',
            'Sec-CH-Viewport-Width',
        )
        return Number(useRequestHeader(VIEWPORT_HINT)) || 0
    })

    if (import.meta.client) {
        const update = () => {
            width.value = window.innerWidth
        }
        const nuxtApp = useNuxtApp()
        if (nuxtApp.isHydrating)
            nuxtApp.hooks.hookOnce('app:suspense:resolve', update)
        else update()
        useEventListener('resize', update, { passive: true })
    }

    return {
        width,
        xs: computed(() => width.value < BREAKPOINTS.sm),
        smAndUp: computed(() => width.value >= BREAKPOINTS.sm),
        smAndDown: computed(() => width.value < BREAKPOINTS.md),
        mdAndUp: computed(() => width.value >= BREAKPOINTS.md),
        mdAndDown: computed(() => width.value < BREAKPOINTS.lg),
        lgAndUp: computed(() => width.value >= BREAKPOINTS.lg),
        xlAndUp: computed(() => width.value >= BREAKPOINTS.xl),
    }
}
