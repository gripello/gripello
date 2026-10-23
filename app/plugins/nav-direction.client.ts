import { useTimeoutFn } from '@vueuse/core'
import { navDirection, type NavDirection } from '~/utils/navigation'

const SLIDE_WAIT_MS = 150

export default defineNuxtPlugin((nuxtApp) => {
    const router = useRouter()
    const forcedPop = useForcedPop()
    const root = document.documentElement
    let position: number | undefined = history.state?.position
    let pending: NavDirection = null
    let sliding: ViewTransition | undefined

    // A view transition stops painting until the new page has loaded; a slow page skips the slide so the tap shows at once.
    const skipSlowSlide = useTimeoutFn(
        () => sliding?.skipTransition(),
        SLIDE_WAIT_MS,
        { immediate: false },
    )

    router.beforeEach((to, from) => {
        const current: number | undefined = history.state?.position
        const target = current !== position ? current : (position ?? 0) + 1
        pending = forcedPop.value
            ? 'pop'
            : navDirection(position, target, from.path, to.path)
        forcedPop.value = false
    })
    router.afterEach(() => {
        position = history.state?.position
    })
    nuxtApp.hook('page:view-transition:start', (transition) => {
        sliding = transition
        skipSlowSlide.start()
        void transition.updateCallbackDone
            .catch(() => {})
            .finally(() => {
                if (sliding === transition) skipSlowSlide.stop()
            })
        if (!pending) return
        root.dataset.nav = pending
        pending = null
        void transition.finished.finally(() => delete root.dataset.nav)
    })
})
