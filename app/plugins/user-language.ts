import { isLocaleCode } from '~/utils/locales'
import { useAuthState } from '~/api/auth'

export default defineNuxtPlugin(async (nuxtApp) => {
    const auth = useAuthState()
    const i18n = nuxtApp.$i18n

    const applyUserLanguage = async (language?: string | null) => {
        if (
            isLocaleCode(language) &&
            language !== i18n.locale.value &&
            i18n.availableLocales.includes(language)
        ) {
            await i18n.setLocale(language)
        }
    }

    await applyUserLanguage(auth.currentUser()?.language)

    if (import.meta.client) {
        auth.onAuthChange((_, record) => applyUserLanguage(record?.language))
    }
})
