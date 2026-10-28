import messages from './en.json'

export default defineI18nLocale(async () => {
    return {
        ...messages,
    }
})
