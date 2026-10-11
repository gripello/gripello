import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import nl from '../../i18n/locales/nl.json'

type Messages = { [key: string]: string | Messages }

const flatten = (messages: Messages, prefix = ''): Record<string, string> =>
    Object.fromEntries(
        Object.entries(messages).flatMap(([key, value]) =>
            typeof value === 'string'
                ? [[prefix + key, value]]
                : Object.entries(flatten(value, `${prefix}${key}.`)),
        ),
    )

const english = flatten(en)
const translations = { de, nl, fr, es }

const migrationsDir = 'backend/internal/platform/db/migrations'
const seededPermissions = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .flatMap((file) => [
        ...readFileSync(`${migrationsDir}/${file}`, 'utf8').matchAll(
            /\('[a-z0-9]{15}', '([a-z]+_[a-z_]+)', '/g,
        ),
    ])
    .map((match) => match[1]!)

describe('locales', () => {
    it('labels every seeded permission', () => {
        expect(seededPermissions).toContain('manage_tasks')
        for (const permission of seededPermissions) {
            expect(english).toHaveProperty([
                `permissions.features.${permission}`,
            ])
        }
    })

    it.each(Object.entries(translations))(
        '%s has exactly the english keys',
        (_, messages) => {
            expect(Object.keys(flatten(messages)).sort()).toEqual(
                Object.keys(english).sort(),
            )
        },
    )

    it.each(Object.entries(translations))(
        '%s translates relative times',
        (_, messages) => {
            const translated = flatten(messages)
            for (const key of Object.keys(english).filter((key) =>
                key.startsWith('time.'),
            )) {
                expect(translated[key]).not.toBe(english[key])
            }
        },
    )
})

describe('plural forms', () => {
    const formsPerLocale = { en: 2, de: 2, nl: 2, fr: 2, es: 2 }

    it.each(Object.entries({ en, ...translations }))(
        '%s uses one form or the full set of plural forms',
        (locale, messages) => {
            const expected =
                formsPerLocale[locale as keyof typeof formsPerLocale]
            for (const [key, value] of Object.entries(flatten(messages))) {
                const forms = value.split(' | ').length
                expect([1, expected], key).toContain(forms)
            }
        },
    )

    it('renders the grammatical form for each count', async () => {
        vi.stubGlobal('defineI18nConfig', (config: unknown) => config)
        const { default: config } = await import('../../i18n/i18n.config')
        const i18n = createI18n({
            ...(config as () => object)(),
            legacy: false,
            locale: 'en',
            messages: { en, de, nl, fr, es },
        })
        const t = i18n.global.t

        expect(t('analytics.labels.routeCount', { n: 1 }, 1)).toBe('1 route')
        expect(t('analytics.labels.routeCount', { n: 0 }, 0)).toBe('0 routes')

        i18n.global.locale.value = 'de'
        expect(t('time.daysAgo', { n: 1 }, 1)).toBe('vor 1 Tag')
        expect(t('time.daysAgo', { n: 4 }, 4)).toBe('vor 4 Tagen')

        i18n.global.locale.value = 'fr'
        expect(t('analytics.labels.routeCount', { n: 0 }, 0)).toBe('0 voie')
        expect(t('analytics.labels.routeCount', { n: 2 }, 2)).toBe('2 voies')
    })
})

describe('message syntax', () => {
    it.each(Object.entries({ en, de, nl, fr, es }))(
        '%s compiles every message',
        async (locale, messages) => {
            vi.stubGlobal('defineI18nConfig', (config: unknown) => config)
            const { default: config } = await import('../../i18n/i18n.config')
            const i18n = createI18n({
                ...(config as () => object)(),
                legacy: false,
                locale,
                messages: { [locale]: messages },
            })
            for (const key of Object.keys(flatten(messages)))
                expect(() => i18n.global.t(key, {}), key).not.toThrow()
        },
    )
})

describe('locale loading', () => {
    it('lets the server cache the messages of the plain loader files', () => {
        expect(readFileSync('nuxt.config.ts', 'utf8')).toContain(
            'file: { path: `${code}.ts`, cache: true }',
        )
    })
})
