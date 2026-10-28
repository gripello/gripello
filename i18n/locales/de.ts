import messages from './de.json'

export default defineI18nLocale(async () => {
    return {
        ...messages,
    }
})
