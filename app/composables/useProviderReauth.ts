import { useIntervalFn } from '@vueuse/core'
import { startOAuth2 } from '~/api/auth'
import { isNativeApp, openSignInPage } from '~/utils/native'
import {
    REAUTH_CHANNEL,
    REAUTH_PAGE,
    markProviderConfirmed,
    providerConfirmationFresh,
    providerConfirmedAt,
    type ReauthMessage,
} from '~/utils/providerReauth'

// Accounts without a password confirm through their sign-in provider: a popup on the web keeps the open dialog,
// the app's Custom Tab returns to the page and the reauth plugin redeems the ticket there.
export function useProviderReauth() {
    const route = useRoute()
    const pending = ref('')
    const failed = ref(false)
    const popup = shallowRef<Window | null>(null)
    const { pause, resume } = useIntervalFn(
        () => {
            if (popup.value?.closed) finish(false)
        },
        500,
        { immediate: false },
    )

    let channel: BroadcastChannel | undefined
    function finish(ok: boolean) {
        pause()
        channel?.close()
        channel = undefined
        popup.value = null
        pending.value = ''
        failed.value = !ok
        if (ok) markProviderConfirmed()
    }

    async function confirmWith(provider: string) {
        if (pending.value) return
        failed.value = false
        pending.value = provider
        const window_ = isNativeApp()
            ? null
            : window.open('', 'gripello-reauth', 'popup,width=480,height=640')
        try {
            const { url } = await startOAuth2(provider, {
                reauth: true,
                redirect: window_ ? REAUTH_PAGE : route.fullPath,
            })
            if (!window_) {
                // The Custom Tab hands back through the app link; when it closes, the page is the one that asked.
                await openSignInPage(url)
                pending.value = ''
                return
            }
            channel = new BroadcastChannel(REAUTH_CHANNEL)
            channel.onmessage = (event: MessageEvent<ReauthMessage>) =>
                finish(event.data.ok)
            popup.value = window_
            window_.location.href = url
            resume()
        } catch (error) {
            window_?.close()
            finish(false)
            throw error
        }
    }

    const confirmed = computed(
        () => providerConfirmedAt.value > 0 && providerConfirmationFresh(),
    )

    return { pending, failed, confirmed, confirmWith }
}
