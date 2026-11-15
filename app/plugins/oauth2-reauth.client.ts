import { finishOAuth2Reauth } from '~/api/auth'
import { markProviderConfirmed, REAUTH_PAGE } from '~/utils/providerReauth'

// The app's Custom Tab (or a blocked popup) returns to the page that asked; redeem the ticket there.
export default defineNuxtPlugin((nuxtApp) => {
    const router = useRouter()
    const { success, error } = useNotification()
    const t = nuxtApp.$i18n.t

    nuxtApp.hook('app:mounted', async () => {
        const route = router.currentRoute.value
        if (route.path === REAUTH_PAGE) return
        const { oauth2Reauth, oauth2ReauthError, ...rest } = route.query
        if (!oauth2Reauth && !oauth2ReauthError) return
        await router.replace({ query: rest })
        const ok =
            typeof oauth2Reauth === 'string' &&
            (await finishOAuth2Reauth(oauth2Reauth).then(
                () => true,
                () => false,
            ))
        if (!ok) return error(t('auth.reauth.failed'))
        markProviderConfirmed()
        success(t('auth.reauth.repeat'))
    })
})
