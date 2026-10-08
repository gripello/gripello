import fs from 'node:fs'
import path from 'node:path'
import type { TestInfo } from '@playwright/test'

const LOCALES_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    'i18n',
    'locales',
)

type Messages = { [key: string]: string | Messages }

const cache = new Map<string, Messages>()

function messages(language: string): Messages {
    if (!cache.has(language)) {
        cache.set(
            language,
            JSON.parse(
                fs.readFileSync(
                    path.join(LOCALES_DIR, `${language}.json`),
                    'utf8',
                ),
            ),
        )
    }
    return cache.get(language)!
}

export function projectLanguage(testInfo: TestInfo) {
    return String(testInfo.project.use.locale ?? 'en').split('-')[0]!
}

export function translate(
    language: string,
    key: string,
    params: Record<string, string | number> = {},
) {
    const value = key
        .split('.')
        .reduce<string | Messages | undefined>(
            (node, part) => (typeof node === 'object' ? node[part] : undefined),
            messages(language),
        )
    if (typeof value !== 'string') {
        throw new Error(`Missing ${language} translation for ${key}`)
    }
    return value.replace(/\{(\w+)\}/g, (match, name) =>
        name in params ? String(params[name]) : match,
    )
}
