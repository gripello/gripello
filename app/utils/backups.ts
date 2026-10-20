const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

export function formatBytes(bytes: number, locale?: string) {
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: units[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
    }).format(value)
}

// Backups run at hh:30 UTC; the label shows that moment in the viewer's time zone on the next run's day, so it matches across DST.
export function backupHourOptions(
    locale?: string,
    timeZone?: string,
    now = new Date(),
) {
    const format = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    })
    return Array.from({ length: 24 }, (_, hour) => ({
        value: hour,
        label: format.format(nextBackupRun(hour, now)),
    }))
}

export function timeZoneName(
    locale?: string,
    timeZone?: string,
    at = new Date(),
) {
    return (
        new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
            .formatToParts(at)
            .find((part) => part.type === 'timeZoneName')?.value ?? ''
    )
}

// The next scheduled run at hh:30 UTC after `now`.
export function nextBackupRun(hour: number, now = new Date()) {
    const next = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            hour,
            30,
        ),
    )
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    return next
}

export function syncCleanForm<T extends object>(
    form: T,
    next: T | undefined,
    previous: T | undefined,
) {
    if (!next) return
    const untouched =
        !previous ||
        (Object.keys(previous) as (keyof T)[]).every(
            (key) => form[key] === previous[key],
        )
    if (untouched) Object.assign(form, next)
}
