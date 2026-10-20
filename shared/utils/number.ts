export function formatNumber(
    value: number | null | undefined,
    locale: string,
    fractionDigits = 1,
): string {
    if (value == null || !Number.isFinite(value)) return '—'
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value)
}

const BYTE_UNITS = [
    'byte',
    'kilobyte',
    'megabyte',
    'gigabyte',
    'terabyte',
] as const

export function formatBytes(bytes: number, locale?: string) {
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024
        unit++
    }
    return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: BYTE_UNITS[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
    }).format(value)
}

export function formatPercent(rate: number, locale?: string) {
    return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: rate && rate < 0.01 ? 2 : 1,
    }).format(rate)
}

export function formatCompact(value: number, locale?: string) {
    return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value)
}
