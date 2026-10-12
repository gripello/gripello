import { reportClientError } from '~/api/platform'
import { createReporter, routePattern } from '~/utils/clientErrors'

export default defineNuxtPlugin((nuxtApp) => {
    const router = useRouter()
    const version = String(useRuntimeConfig().public.appVersion ?? '')
    const report = createReporter((body) => {
        nuxtApp.runWithContext(() => reportClientError(body)).catch(() => {})
    })
    const context = () => ({
        route: routePattern(router.currentRoute.value.matched),
        version,
    })

    nuxtApp.hook('vue:error', (error) => report('vue', error, context()))
    nuxtApp.hook('app:error', (error) => report('nuxt', error, context()))
    nuxtApp.hook('app:chunkError', ({ error }) =>
        report('chunk', error, context()),
    )
    window.addEventListener('error', (event) =>
        report('window', event.error ?? event.message, context()),
    )
    window.addEventListener('unhandledrejection', (event) =>
        report('promise', event.reason, context()),
    )
})
