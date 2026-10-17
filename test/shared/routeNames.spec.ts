import { describe, expect, it } from 'vitest'
import {
    COLOR_FAMILIES,
    colorFamily,
    difficultyTier,
    DIFFICULTY_TIERS,
    generateRouteName,
    ROUTE_NAME_GRAMMAR,
    ROUTE_NAME_MAX_LENGTH,
} from '#shared/utils/routeNames'
import { gradeIndex } from '#shared/utils/grades'
import { SUPPORTED_LOCALES } from '~/utils/locales'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import nl from '../../i18n/locales/nl.json'

const ROUTE_NAME_WORDS = {
    de: de.routeNames,
    en: en.routeNames,
    es: es.routeNames,
    fr: fr.routeNames,
    nl: nl.routeNames,
} as Record<string, typeof en.routeNames>

const wordsFor =
    (locale: string) =>
    (key: string): string =>
        key
            .split('.')
            .reduce<unknown>(
                (node, part) => (node as Record<string, unknown>)[part],
                ROUTE_NAME_WORDS[locale],
            ) as string

const LOCALES = SUPPORTED_LOCALES.map((l) => l.code)
const MOOD = 0
const COLOR = 0.4
const COLOR_NOUN = 0.9
const FIRST = 0
const LAST = 0.999

const fixed = (...values: number[]) => {
    let call = 0
    return () => values[call++ % values.length]!
}

const wordsOf = (list: string) =>
    list
        .split(' ')
        .flatMap((entry) => entry.split('.')[0]!.split('/'))
        .map((word) => word.toLowerCase())

describe('generateRouteName', () => {
    it('has a grammar for every app locale', () => {
        expect(Object.keys(ROUTE_NAME_GRAMMAR).sort()).toEqual(
            [...LOCALES].sort(),
        )
    })

    it.each(LOCALES)('fills every tier and color in %s', (locale) => {
        const words = ROUTE_NAME_WORDS[locale]!
        const { genders } = ROUTE_NAME_GRAMMAR[locale]!
        for (const tier of DIFFICULTY_TIERS)
            expect(wordsOf(words.mood[tier]).length).toBeGreaterThanOrEqual(8)
        for (const family of COLOR_FAMILIES) {
            expect(words.colors[family]).toBeTruthy()
            expect(
                words.colorNouns[family].split(' ').length,
            ).toBeGreaterThanOrEqual(4)
        }
        for (const entry of [
            ...Object.values(words.nouns),
            ...Object.values(words.colorNouns),
        ].flatMap((list) => list.split(' '))) {
            if (genders) expect(genders, entry).toContain(entry.split('.')[1])
        }
    })

    it.each(LOCALES)('builds short two-word names in %s', (locale) => {
        for (const type of ['Route', 'Boulder', '']) {
            for (const color of ['#E53935', '#111111', '#9E9E9E', null]) {
                for (let i = 0; i < 50; i++) {
                    const name = generateRouteName(locale, wordsFor(locale), {
                        type,
                        color,
                        gradeIndex: 20,
                    })
                    expect(name).toMatch(/^\S+ \S+$/)
                    expect(name.length).toBeLessThanOrEqual(
                        ROUTE_NAME_MAX_LENGTH,
                    )
                }
            }
        }
    })

    it('uses the hold color as adjective', () => {
        expect(
            generateRouteName(
                'en',
                wordsFor('en'),
                { type: 'Boulder', color: '#1E88E5' },
                fixed(COLOR, FIRST, FIRST),
            ),
        ).toBe('Blue Crimp')
        expect(
            generateRouteName(
                'de',
                wordsFor('de'),
                { type: 'Route', color: '#E53935' },
                fixed(COLOR, FIRST, FIRST),
            ),
        ).toBe('Rote Linie')
        expect(
            generateRouteName(
                'fr',
                wordsFor('fr'),
                { type: 'Boulder', color: '#FFFFFF' },
                fixed(COLOR, FIRST, FIRST),
            ),
        ).toBe('Réglette Blanche')
    })

    it('picks color-themed nouns', () => {
        expect(
            generateRouteName(
                'en',
                wordsFor('en'),
                { color: '#43A047' },
                fixed(COLOR_NOUN, FIRST, FIRST),
            ),
        ).toBe('Silent Frog')
    })

    it('picks nouns for the route type', () => {
        expect(
            generateRouteName(
                'en',
                wordsFor('en'),
                { type: 'Boulder' },
                fixed(MOOD, FIRST, FIRST),
            ),
        ).toBe('Silent Crimp')
        expect(
            generateRouteName(
                'en',
                wordsFor('en'),
                { type: 'Route' },
                fixed(MOOD, FIRST, FIRST),
            ),
        ).toBe('Silent Line')
    })

    it('matches the mood to the grade', () => {
        const words = ROUTE_NAME_WORDS.en!
        const adjective = (type: string, system: string, grade: string) =>
            generateRouteName('en', wordsFor('en'), {
                type,
                gradeIndex: gradeIndex(system, grade),
            })
                .split(' ')[0]!
                .toLowerCase()
        for (let i = 0; i < 30; i++) {
            expect(wordsOf(words.mood.hard)).toContain(
                adjective('Boulder', 'font', '7C'),
            )
            expect(wordsOf(words.mood.easy)).toContain(
                adjective('Route', 'french', '4'),
            )
        }
    })

    it.each(['de', 'nl', 'fr', 'es'])(
        'agrees the adjective with the noun gender in %s',
        (locale) => {
            const words = ROUTE_NAME_WORDS[locale]!
            const grammar = ROUTE_NAME_GRAMMAR[locale]!
            const nounGender = new Map(
                [
                    ...Object.values(words.nouns),
                    ...Object.values(words.colorNouns),
                ]
                    .flatMap((list) => list.split(' '))
                    .map((entry) => {
                        const [word, gender] = entry.split('.')
                        return [
                            word!.toLowerCase(),
                            grammar.genders.indexOf(gender!),
                        ]
                    }),
            )
            const adjectiveForms = [
                ...Object.values(words.mood),
                ...Object.values(words.colors),
            ]
                .flatMap((list) => list.split(' '))
                .map((entry) =>
                    entry.includes('/') || !grammar.endings
                        ? entry.split('/')
                        : grammar.endings.map((ending) => entry + ending),
                )
            for (let i = 0; i < 300; i++) {
                const parts = generateRouteName(locale, wordsFor(locale), {
                    type: i % 2 ? 'Boulder' : 'Route',
                    color: '#E53935',
                })
                    .toLowerCase()
                    .split(' ')
                const [adjective, noun] = grammar.adjectiveFirst
                    ? parts
                    : [...parts].reverse()
                const gender = nounGender.get(noun!)!
                expect(
                    adjectiveForms.some(
                        (forms) => (forms[gender] ?? forms[0]) === adjective,
                    ),
                    parts.join(' '),
                ).toBe(true)
            }
        },
    )

    it('never repeats the name to avoid', () => {
        expect(
            generateRouteName(
                'en',
                wordsFor('en'),
                { type: 'Boulder' },
                fixed(MOOD, FIRST),
                'Silent Crimp',
            ),
        ).toBe('Hidden Crimp')
    })

    it('keeps the current name when nothing else fits', () => {
        const single = (key: string) => (key === 'mood.mid' ? 'quiet' : 'crimp')
        expect(
            generateRouteName('en', single, {}, Math.random, 'Quiet Crimp'),
        ).toBe('Quiet Crimp')
    })

    it.each(LOCALES)('keeps the %s word lists plain text', (locale) => {
        const lists = Object.values(ROUTE_NAME_WORDS[locale]!).flatMap(
            (group) => Object.values(group as Record<string, string>),
        )
        for (const list of lists) {
            expect(list).toMatch(/^[^\s|{}@$%]+( [^\s|{}@$%]+)*$/)
        }
    })

    it('falls back to English grammar for unknown locales', () => {
        expect(
            generateRouteName(
                'xx',
                wordsFor('en'),
                { type: 'Boulder' },
                fixed(MOOD, FIRST, FIRST),
            ),
        ).toBe('Silent Crimp')
    })
})

describe('difficultyTier', () => {
    it('splits at 6a/7a for routes and 6A/7A for boulders', () => {
        expect(difficultyTier('Route', gradeIndex('french', '5+'))).toBe('easy')
        expect(difficultyTier('Route', gradeIndex('french', '6a'))).toBe('mid')
        expect(difficultyTier('Route', gradeIndex('french', '7a'))).toBe('hard')
        expect(difficultyTier('Boulder', gradeIndex('font', '5+'))).toBe('easy')
        expect(difficultyTier('Boulder', gradeIndex('font', '6A'))).toBe('mid')
        expect(difficultyTier('Boulder', gradeIndex('font', '7A'))).toBe('hard')
        expect(difficultyTier('Boulder', null)).toBe('mid')
    })
})

describe('colorFamily', () => {
    it.each([
        ['#E53935', 'red'],
        ['#FF5722', 'orange'],
        ['#FDD835', 'yellow'],
        ['#43A047', 'green'],
        ['#00ACC1', 'blue'],
        ['#1E88E5', 'blue'],
        ['#8E24AA', 'purple'],
        ['#EC407A', 'pink'],
        ['#000000', 'black'],
        ['#FFFFFF', 'white'],
        ['#9E9E9E', 'grey'],
        ['#6D4C41', 'brown'],
    ])('%s is %s', (hex, family) => {
        expect(colorFamily(hex)).toBe(family)
    })

    it('ignores invalid colors', () => {
        expect(colorFamily('')).toBeNull()
        expect(colorFamily(null)).toBeNull()
    })
})
