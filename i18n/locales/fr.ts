import messages from './fr.json'

export default defineI18nLocale(async (locale) => {
    return {
        ...messages,
    }
})
