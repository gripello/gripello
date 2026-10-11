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

// Backups run at hh:30 UTC; the label shows that moment in the viewer's time zone.
export function backupHourOptions(locale?: string, timeZone?: string) {
    const format = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    })
    return Array.from({ length: 24 }, (_, hour) => ({
        value: hour,
        label: format.format(Date.UTC(2026, 0, 15, hour, 30)),
    }))
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
