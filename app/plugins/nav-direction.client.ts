import { navDirection, type NavDirection } from '~/utils/navigation'

export default defineNuxtPlugin((nuxtApp) => {
    const router = useRouter()
    const forcedPop = useForcedPop()
    const root = document.documentElement
    let position: number | undefined = history.state?.position
    let pending: NavDirection = null

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
        if (!pending) return
        root.dataset.nav = pending
        pending = null
        void transition.finished.finally(() => delete root.dataset.nav)
    })
})
