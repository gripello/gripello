export type Rgba = [number, number, number, number]

export function parseHexColor(value: unknown): Rgba | null {
    const digits = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(
        typeof value === 'string' ? value.trim() : '',
    )?.[1]
    if (!digits) return null
    const full =
        digits.length <= 4
            ? [...digits].map((digit) => digit + digit).join('')
            : digits
    const [r, g, b, a] = full.match(/../g)!.map((pair) => parseInt(pair, 16))
    return [r!, g!, b!, a === undefined ? 1 : a / 255]
}

export function toHex6(value: unknown): string {
    const rgba = parseHexColor(value)
    return rgba
        ? `#${rgba
              .slice(0, 3)
              .map((channel) => channel.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()}`
        : ''
}

export function normalizeHexColor(color: unknown): string {
    return toHex6(color) || '#9E9E9E'
}
