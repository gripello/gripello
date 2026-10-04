import { formatNumber } from './number'

export function formatDateToYYYYMMDD(date: string | null | undefined): string {
    return parseDate(date)?.toISOString().slice(0, 10) ?? ''
}

export function localDateYYYYMMDD(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const DAY_MS = 86_400_000

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
    locale?: string | null
    fallback?: string
    withTime?: boolean
}

export function parseDate(
    value: string | Date | null | undefined,
): Date | null {
    if (!value) return null
    const parsed =
        value instanceof Date
            ? value
            : new Date(String(value).replace(' ', 'T'))
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(
    value: string | Date | null | undefined,
    {
        locale,
        fallback = '',
        withTime = false,
        ...intl
    }: FormatDateOptions = {},
): string {
    const parsed = parseDate(value)
    if (!parsed) return fallback
    const resolvedLocale = locale || undefined
    const isDateOnly = parsed.getTime() % DAY_MS === 0
    if (!withTime && !intl.timeZone && isDateOnly) intl.timeZone = 'UTC'
    return withTime
        ? parsed.toLocaleString(resolvedLocale, intl)
        : parsed.toLocaleDateString(resolvedLocale, intl)
}

export function timeAgo(
    dateStr: string | null | undefined,
    t: (
        key: string,
        named?: Record<string, unknown>,
        plural?: number,
    ) => string,
    locale: string,
): string {
    const parsed = parseDate(dateStr)
    if (!parsed) return ''
    const diff = Date.now() - parsed.getTime()
    const mins = Math.floor(diff / 60_000)
    const hours = Math.floor(diff / 3_600_000)
    const days = Math.floor(diff / 86_400_000)
    if (mins < 1) return t('time.justNow')
    if (mins < 60) return t('time.minutesAgo', { n: mins }, mins)
    if (hours < 24) return t('time.hoursAgo', { n: hours }, hours)
    if (days < 30) return t('time.daysAgo', { n: days }, days)
    return parsed.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

export function wallName(
    record: { expand?: Record<string, unknown> } | null | undefined,
): string {
    const wall = record?.expand?.wall as { name?: string } | undefined
    return wall?.name ?? ''
}

export function locationName(
    record:
        | {
              expand?: Record<string, unknown>
          }
        | null
        | undefined,
): string {
    const location = record?.expand?.location as { name?: string } | undefined
    return location?.name ?? ''
}

export function formatAnchorPoint(value: unknown): unknown {
    if (value === null || value === undefined || value === '') {
        return '—'
    }
    if (Number(value) === 0) {
        return '-'
    }
    return value
}

export function formatScore(
    route: { score?: unknown } | null | undefined,
    locale = 'en',
): string {
    const score =
        typeof route?.score === 'number' && Number.isFinite(route.score)
            ? route.score
            : null
    return score !== null ? `${formatNumber(score, locale, 2)}/5` : '—'
}

export function normalizeCreators(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean)
    }
    if (typeof raw === 'string') {
        return raw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
    }
    return []
}
