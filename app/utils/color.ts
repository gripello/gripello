import { parseHexColor, toHex6 } from '#shared/utils/color'

export const FALLBACK_DOT_COLOR = '#9E9E9E'

function rgbChannels(hex: string) {
    return parseHexColor(hex)?.slice(0, 3) as
        [number, number, number] | undefined
}

function relativeLuminance(hex: string) {
    const rgb = rgbChannels(hex)
    if (!rgb) return undefined
    const [red, green, blue] = rgb.map((channel) => {
        const c = channel / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(foreground: string, background: string) {
    const a = relativeLuminance(foreground) ?? 0
    const b = relativeLuminance(background) ?? 0
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function readableTextOn(hex: string | null | undefined): string {
    const luminance = relativeLuminance(toHex6(hex))
    if (luminance === undefined) return 'inherit'

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
