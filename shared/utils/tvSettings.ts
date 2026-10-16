export const TV_SLIDES = [
    'new_routes',
    'leaderboard',
    'resets',
    'info',
    'announcements',
] as const
export const TV_SECONDS_PRESETS = [8, 12, 20, 30] as const
export const TV_MIN_SECONDS = 5
export const TV_MAX_SECONDS = 120
export const TV_MAX_SCREENS = 10
export const TV_MAX_SCREEN_NAME_LENGTH = 50
export const TV_MAX_ANNOUNCEMENTS = 10
export const TV_MAX_ANNOUNCEMENT_LENGTH = 120

export type TvSlide = (typeof TV_SLIDES)[number]
export interface TvAnnouncement {
    text: string
    until?: string
}
export interface TvScreen {
    id: string
    name?: string
    slides?: TvSlide[]
    seconds?: number
    location?: string
    takeover?: boolean
}
export interface TvSettings {
    screens?: TvScreen[]
    announcements?: TvAnnouncement[]
}
export type ResolvedTvScreen = Required<TvScreen>
export interface ResolvedTvSettings {
    screens: ResolvedTvScreen[]
    announcements: TvAnnouncement[]
}

export const DEFAULT_TV_SCREEN_ID = 'main'

export function defaultTvScreen(id = DEFAULT_TV_SCREEN_ID): ResolvedTvScreen {
    return {
        id,
        name: '',
        slides: [...TV_SLIDES],
        seconds: 12,
        location: '',
        takeover: true,
    }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[a-z0-9]{1,15}$/
const LOCATION = /^[a-z0-9]{0,15}$/
const SCREEN_KEYS = ['id', 'name', 'slides', 'seconds', 'location', 'takeover']

function isIsoDate(value: string) {
    if (!DATE.test(value)) return false
    const date = new Date(`${value}T00:00:00Z`)
    return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
    return Object.keys(value).every((key) => keys.includes(key))
}

function isValidAnnouncement(value: unknown) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ['text', 'until'])) {
        return false
    }
    const { text, until } = value
    if (typeof text !== 'string') return false
    const length = [...text.trim()].length
    if (length === 0 || length > TV_MAX_ANNOUNCEMENT_LENGTH) return false
    return (
        until === undefined ||
        until === '' ||
        (typeof until === 'string' && isIsoDate(until))
    )
}

function isValidScreen(value: unknown) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, SCREEN_KEYS)) return false
    const { id, name, slides, seconds, location, takeover } = value
    if (typeof id !== 'string' || !ID.test(id)) return false
    if (
        name !== undefined &&
        !(
            typeof name === 'string' &&
            [...name].length <= TV_MAX_SCREEN_NAME_LENGTH
        )
    ) {
        return false
    }
    if (
        slides !== undefined &&
        !(
            Array.isArray(slides) &&
            slides.every(
                (slide, i) =>
                    (TV_SLIDES as readonly unknown[]).includes(slide) &&
                    slides.indexOf(slide) === i,
            )
        )
    ) {
        return false
    }
    if (
        seconds !== undefined &&
        !(
            Number.isInteger(seconds) &&
            (seconds as number) >= TV_MIN_SECONDS &&
            (seconds as number) <= TV_MAX_SECONDS
        )
    ) {
        return false
    }
    if (
        location !== undefined &&
        !(typeof location === 'string' && LOCATION.test(location))
    ) {
        return false
    }
    return takeover === undefined || typeof takeover === 'boolean'
}

// Mirrored in backend/internal/gyms/tv.go.
export function isValidTvSettings(value: unknown): value is TvSettings | null {
    if (value === null || value === undefined) return true
    if (
        !isPlainObject(value) ||
        !hasOnlyKeys(value, ['screens', 'announcements'])
    ) {
        return false
    }
    const { screens, announcements } = value
    if (
        screens !== undefined &&
        !(
            Array.isArray(screens) &&
            screens.length <= TV_MAX_SCREENS &&
            screens.every(isValidScreen) &&
            new Set(screens.map((screen) => screen.id)).size === screens.length
        )
    ) {
        return false
    }
    return (
        announcements === undefined ||
        (Array.isArray(announcements) &&
            announcements.length <= TV_MAX_ANNOUNCEMENTS &&
            announcements.every(isValidAnnouncement))
    )
}

export function tvSettingsOf(
    gym: { tv_settings?: TvSettings | null } | null | undefined,
): ResolvedTvSettings {
    const settings = gym?.tv_settings
    const screens = settings?.screens?.length
        ? settings.screens.map((screen) => ({
              ...defaultTvScreen(screen.id),
              ...screen,
          }))
        : [defaultTvScreen()]
    return { screens, announcements: settings?.announcements ?? [] }
}

export function tvScreenOf(settings: ResolvedTvSettings, id: string) {
    return (
        settings.screens.find((screen) => screen.id === id) ??
        settings.screens[0]!
    )
}
