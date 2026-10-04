function frenchPluralRule(choice: number, choicesLength: number): number {
    if (choicesLength < 2) return 0
    return choice <= 1 ? 0 : 1
}

export default defineI18nConfig(() => ({
    legacy: false,
    pluralRules: {
        fr: frenchPluralRule,
    },
}))
