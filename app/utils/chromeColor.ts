import { parseHexColor, type Rgba } from '#shared/utils/color'

export function parseColor(value: string): Rgba | null {
    if (value.trim().startsWith('#')) return parseHexColor(value)
    const rgb = value.match(/rgba?\(([^)]+)\)/i)?.[1]
    if (!rgb) return null
    const [r, g, b, a] = rgb
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number)
    if ([r, g, b].some((channel) => channel === undefined || isNaN(channel!)))
        return null
    return [r!, g!, b!, a === undefined || isNaN(a) ? 1 : a]
}

export function toHex([r, g, b]: Rgba): string {
    return `#${[r, g, b]
        .map((channel) =>
            Math.round(Math.min(255, Math.max(0, channel)))
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`
}

export function mixColors(from: string, to: string, progress: number): string {
    const start = parseColor(from)
    const end = parseColor(to)
    if (!start || !end) return to
    return toHex(
        start.map(
            (channel, index) => channel + (end[index]! - channel) * progress,
        ) as Rgba,
    )
}

export function compositeOver(base: string, overlay: string): string {
    const below = parseColor(base)
    const above = parseColor(overlay)
    if (!below || !above) return base
    const alpha = above[3]
    return toHex([
        above[0] * alpha + below[0] * (1 - alpha),
        above[1] * alpha + below[1] * (1 - alpha),
        above[2] * alpha + below[2] * (1 - alpha),
        1,
    ])
}
