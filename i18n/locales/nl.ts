import messages from './nl.json'

export default defineI18nLocale(async (locale) => {
    return {
        ...messages,
    }
})
