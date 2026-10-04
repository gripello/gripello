export const SUPPORTED_LOCALES = [
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' },
    { code: 'nl', name: 'Nederlands' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' },
] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code']

export const DEFAULT_LOCALE: LocaleCode = 'en'

export function isLocaleCode(value: unknown): value is LocaleCode {
    return SUPPORTED_LOCALES.some((locale) => locale.code === value)
}
