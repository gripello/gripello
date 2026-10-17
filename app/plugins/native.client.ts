import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import {
    APP_SCHEME,
    appLinkPath,
    backAction,
    externalUrl,
    isNativeApp,
    openInBrowser,
} from '~/utils/native'
import { parentPath } from '~/utils/navigation'

export default defineNuxtPlugin(async (nuxtApp) => {
    if (!isNativeApp()) return
    const [{ App }, { SplashScreen }, { PushNotifications }] =
        await Promise.all([
            import('@capacitor/app'),
            import('@capacitor/splash-screen'),
            import('@capacitor/push-notifications'),
        ])
    const router = useRouter()
    const colorMode = useColorMode()
    const pageBackTo = usePageBackTo()
    const forcedPop = useForcedPop()

    nuxtApp.hook('app:suspense:resolve', () => void SplashScreen.hide())

    watch(
        () => colorMode.value,
        (mode) =>
            void SystemBars.setStyle({
                style:
                    mode === 'dark'
                        ? SystemBarsStyle.Dark
                        : SystemBarsStyle.Light,
            }),
        { immediate: true },
    )

    void App.addListener('backButton', () => {
        const parent =
            pageBackTo.value?.to ?? parentPath(router.currentRoute.value.path)
        const action = backAction(
            history.state,
            parent,
            !!document.fullscreenElement,
        )
        if (action === 'exitFullscreen')
            return void document.exitFullscreen().catch(() => null)
        if (action === 'history') return history.back()
        if (action === 'minimize' || !parent) return void App.minimizeApp()
        forcedPop.value = true
        void navigateTo(parent, { replace: true })
    })

    const openLink = (url: string) => {
        const path = appLinkPath(url, location.origin)
        if (path) void navigateTo(path)
    }
    void App.addListener('appUrlOpen', ({ url }) => {
        // A sign-in ticket reloads the page so login and settings handle it exactly like the web callback.
        const path = url.startsWith(APP_SCHEME)
            ? appLinkPath(url, location.origin)
            : null
        if (path) location.assign(path)
        else openLink(url)
    })
    void PushNotifications.addListener(
        'pushNotificationActionPerformed',
        ({ notification }) => {
            const url: unknown = notification.data?.url
            if (typeof url === 'string') openLink(url)
        },
    )

    // Other sites open in the in-app browser tab instead of leaving the app for the system browser.
    document.addEventListener('click', (event) => {
        const link = (event.target as Element | null)?.closest?.('a[href]')
        if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented)
            return
        const url = externalUrl(link.href, location.origin)
        if (!url) return
        event.preventDefault()
        void openInBrowser(url)
    })
})
