import { parseHexColor, type Rgba } from './color'

export const ROUTE_NAME_MAX_LENGTH = 30

export const COLOR_FAMILIES = [
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'black',
    'white',
    'grey',
    'brown',
] as const
export type ColorFamily = (typeof COLOR_FAMILIES)[number]

export const DIFFICULTY_TIERS = ['easy', 'mid', 'hard'] as const
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number]

export interface RouteNameContext {
    type?: string | null
    gradeIndex?: number | null
    color?: string | null
}

export type RouteNameWords = (key: string) => string

interface Grammar {
    genders: string
    adjectiveFirst: boolean
    endings?: string[]
}

export const ROUTE_NAME_GRAMMAR: Record<string, Grammar> = {
    en: { genders: '', adjectiveFirst: true },
    de: { genders: 'mfn', adjectiveFirst: true, endings: ['er', 'e', 'es'] },
    nl: { genders: 'dh', adjectiveFirst: true },
    fr: { genders: 'mf', adjectiveFirst: false },
    es: { genders: 'mf', adjectiveFirst: false },
}

// 6a/7a for routes, 6A/7A for boulders on the shared grade_index scale
const TIER_LIMITS = {
    Route: { easyBelow: 11, hardFrom: 17 },
    Boulder: { easyBelow: 15.7, hardFrom: 20.3 },
}

export function difficultyTier(
    type: string | null | undefined,
    gradeIndex: number | null | undefined,
): DifficultyTier {
    if (gradeIndex == null) return 'mid'
    const limits = type === 'Boulder' ? TIER_LIMITS.Boulder : TIER_LIMITS.Route
    if (gradeIndex < limits.easyBelow) return 'easy'
    if (gradeIndex >= limits.hardFrom) return 'hard'
    return 'mid'
}

export function colorFamily(
    color: string | null | undefined,
): ColorFamily | null {
    const rgba = parseHexColor(color)
    if (!rgba) return null
    const [r, g, b] = rgba.map((channel) => channel / 255) as Rgba
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const lightness = (max + min) / 2
    const chroma = max - min
    const saturation =
        chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
    if (lightness < 0.15) return 'black'
    if (lightness > 0.9) return 'white'
    if (saturation < 0.2 || chroma < 0.1)
        return lightness > 0.8 ? 'white' : lightness < 0.2 ? 'black' : 'grey'
    let hue =
        max === r
            ? ((g - b) / chroma) % 6
            : max === g
              ? (b - r) / chroma + 2
              : (r - g) / chroma + 4
    hue = (hue * 60 + 360) % 360
    if (hue < 10 || hue >= 345) return 'red'
    if (hue < 45) return lightness < 0.4 ? 'brown' : 'orange'
    if (hue < 70) return 'yellow'
    if (hue < 170) return 'green'
    if (hue < 255) return 'blue'
    if (hue < 290) return 'purple'
    return 'pink'
}

interface Noun {
    word: string
    gender: number
}

function parseNouns(grammar: Grammar, list: string): Noun[] {
    return list.split(' ').map((entry) => {
        const [word, gender] = entry.split('.')
        return {
            word: word!,
            gender: Math.max(0, grammar.genders.indexOf(gender ?? '')),
        }
    })
}

function parseAdjectives(grammar: Grammar, list: string): string[][] {
    return list.split(' ').map((entry) => {
        const forms = entry.split('/')
        if (forms.length > 1 || !grammar.endings) return forms
        return grammar.endings.map((ending) => `${entry}${ending}`)
    })
}

function pick<T>(items: T[], random: () => number): T {
    return items[Math.floor(random() * items.length)]!
}

function titleCase(name: string, locale: string) {
    return name.replace(
        /(^|\s)(\S)/g,
        (_, space: string, letter: string) =>
            `${space}${letter.toLocaleUpperCase(locale)}`,
    )
}

function namePatterns(
    grammar: Grammar,
    words: RouteNameWords,
    context: RouteNameContext,
) {
    const tier = difficultyTier(context.type, context.gradeIndex)
    const mood = parseAdjectives(grammar, words(`mood.${tier}`))
    const typeNouns = parseNouns(
        grammar,
        `${words(context.type === 'Boulder' ? 'nouns.boulder' : 'nouns.route')} ${words('nouns.any')}`,
    )
    const patterns = [{ adjectives: mood, nouns: typeNouns }]
    const family = colorFamily(context.color)
    if (family) {
        patterns.push(
            {
                adjectives: parseAdjectives(grammar, words(`colors.${family}`)),
                nouns: typeNouns,
            },
            {
                adjectives: mood,
                nouns: parseNouns(grammar, words(`colorNouns.${family}`)),
            },
        )
    }
    return patterns
}

export function generateRouteName(
    locale: string,
    words: RouteNameWords,
    context: RouteNameContext = {},
    random: () => number = Math.random,
    avoid?: string,
): string {
    const grammar = ROUTE_NAME_GRAMMAR[locale] ?? ROUTE_NAME_GRAMMAR.en!
    const patterns = namePatterns(grammar, words, context)
    const namesOf = (pattern: (typeof patterns)[number]) =>
        pattern.nouns
            .flatMap((noun) =>
                pattern.adjectives.map((forms) => {
                    const adjective = forms[noun.gender] ?? forms[0]!
                    return titleCase(
                        grammar.adjectiveFirst
                            ? `${adjective} ${noun.word}`
                            : `${noun.word} ${adjective}`,
                        locale,
                    )
                }),
            )
            .filter(
                (name) =>
                    name !== avoid && name.length <= ROUTE_NAME_MAX_LENGTH,
            )
    const preferred = namesOf(pick(patterns, random))
    const names = preferred.length ? preferred : patterns.flatMap(namesOf)
    return names.length ? pick(names, random) : (avoid ?? '')
}
