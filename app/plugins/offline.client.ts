import { onConnect } from '~/composables/useRealtime'

import { useAuthState } from '~/api/auth'

export default defineNuxtPlugin((nuxtApp) => {
    const auth = useAuthState()
    const outbox = useTickOutbox()
    const flush = () => outbox.flush().catch(() => {})
    let cachedUserId = auth.currentUser()?.id

    function forgetUserCaches() {
        void outbox.clearCachedTicks()
        navigator.serviceWorker?.controller?.postMessage({
            type: 'clear-pages',
        })
    }

    nuxtApp.hook('app:mounted', () => {
        void flush()
        window.addEventListener('online', flush)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void flush()
        })
        onConnect(flush)
    })

    auth.onAuthChange((token, record) => {
        if (!token) {
            cachedUserId = undefined
            return forgetUserCaches()
        }
        if (record?.id !== cachedUserId) forgetUserCaches()
        cachedUserId = record?.id
        void flush()
    })
})
