import messages from './fr.json'

export default defineI18nLocale(async () => {
    return {
        ...messages,
    }
})
