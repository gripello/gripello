import messages from './es.json'

export default defineI18nLocale(async () => {
    return {
        ...messages,
    }
})
