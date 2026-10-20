export const FALLBACK_DOT_COLOR = '#9E9E9E'

export function toHex6(value: string | null | undefined): string {
    const trimmed = (value ?? '').trim()
    const short = /^#?([0-9a-fA-F]{3})$/.exec(trimmed)?.[1]
    if (short) {
        return `#${[...short].map((digit) => digit + digit).join('')}`.toUpperCase()
    }
    const match = /^#?([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(trimmed)
    return match?.[1] ? `#${match[1].toUpperCase()}` : ''
}

function rgbChannels(hex: string): [number, number, number] | null {
    const digits = hex.trim().replace(/^#/, '')
    const full =
        digits.length === 3
            ? [...digits].map((digit) => digit + digit).join('')
            : digits.slice(0, 6)
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
    const value = parseInt(full, 16)
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export function readableTextOn(hex: string | null | undefined): string {
    const rgb = rgbChannels(toHex6(hex))
    if (!rgb) return 'inherit'

    const [red, green, blue] = rgb.map((channel) => {
        const c = channel / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue

    return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05
        ? '#FFFFFF'
        : '#000000'
}

export function isLightColor(hex: string): boolean {
    const rgb = rgbChannels(hex)
    if (!rgb) return false
    const [red, green, blue] = rgb
    return red * 0.299 + green * 0.587 + blue * 0.114 > 160
}

export function shadeColor(hex: string, amount: number): string {
    const rgb = rgbChannels(hex)
    if (!rgb) return hex
    const [red, green, blue] = rgb.map((channel) =>
        Math.min(255, Math.max(0, channel + amount)),
    ) as [number, number, number]
    return `#${((red << 16) | (green << 8) | blue).toString(16).padStart(6, '0')}`
}

export function gradientEndColor(hex: string): string {
    const rgb = rgbChannels(hex)
    if (!rgb) return hex
    const [red, green, blue] = rgb
    const nearlyBlack = red * 0.299 + green * 0.587 + blue * 0.114 < 48
    return shadeColor(hex, nearlyBlack ? 60 : -30)
}

export function routeDotColor(color: string | null | undefined): string {
    return toHex6(color) || FALLBACK_DOT_COLOR
}
