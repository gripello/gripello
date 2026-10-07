export const GYM_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/
export const GYM_SLUG_MAX_LENGTH = 40
export const FALLBACK_GYM_SLUG = 'my-gym'

export const RESERVED_GYM_SLUGS = [
    '_i18n',
    '_nuxt',
    'account',
    'admin',
    'api',
    'auth',
    'climber',
    'competitions',
    'friends',
    'imprint',
    'logbook',
    'manage',
    'map',
    'offline',
    'platform',
    'privacy',
    'route',
    'routes',
    'scan',
]

const FOLDED_LETTERS: Record<string, string> = {
    ä: 'ae',
    ö: 'oe',
    ü: 'ue',
    ß: 'ss',
}

export function isValidGymSlug(slug: string) {
    return GYM_SLUG_PATTERN.test(slug) && !RESERVED_GYM_SLUGS.includes(slug)
}

export function slugifyGymName(name: string) {
    const slug = name
        .toLowerCase()
        .replace(/[äöüß]/g, (letter) => FOLDED_LETTERS[letter]!)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, GYM_SLUG_MAX_LENGTH)
        .replace(/-+$/, '')
    return isValidGymSlug(slug) ? slug : FALLBACK_GYM_SLUG
}
