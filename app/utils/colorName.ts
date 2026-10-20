import { parseHexColor, toHex6 } from '#shared/utils/color'

const NAMED_COLORS = {
    red: ['#d32f2f', '#f44336', '#e53935', '#dc2626', '#ff0000'],
    darkRed: ['#8b1a1a', '#8b0000', '#7f1d1d'],
    orange: ['#fb8c00', '#f97316', '#ff6d00', '#da5307', '#ffa500', '#ff5722'],
    yellow: [
        '#e3b448',
        '#fdd835',
        '#ffeb3b',
        '#facc15',
        '#ffc107',
        '#ffd700',
        '#ffff00',
    ],
    olive: ['#827717', '#808000', '#6b6b1f'],
    lime: [
        '#c6ff00',
        '#d4ff3f',
        '#b2d235',
        '#8bc34a',
        '#39ff14',
        '#cddc39',
        '#a3e635',
    ],
    green: [
        '#66bb6a',
        '#5cd67a',
        '#43a047',
        '#4caf50',
        '#22c55e',
        '#00c853',
        '#2e7d32',
    ],
    darkGreen: ['#1b5e20', '#14532d', '#006400'],
    mint: ['#a5e8c8', '#c8e6c9', '#a5d6a7', '#98ff98'],
    turquoise: [
        '#1fbfb0',
        '#00bcd4',
        '#26c6da',
        '#00e5ff',
        '#00ffff',
        '#40e0d0',
    ],
    teal: ['#00796b', '#009688', '#0f766e', '#008080'],
    lightBlue: ['#81d4fa', '#b3e5fc', '#90caf9', '#87ceeb', '#7dd3fc'],
    blue: [
        '#4682b4',
        '#3b5f8a',
        '#4572a8',
        '#1e88e5',
        '#2196f3',
        '#2563eb',
        '#3f51b5',
        '#0000ff',
    ],
    navy: ['#1a237e', '#1e3a8a', '#000080'],
    purple: [
        '#a020f0',
        '#b620e0',
        '#8e24aa',
        '#9c27b0',
        '#673ab7',
        '#7e22ce',
        '#800080',
        '#4b0082',
    ],
    lavender: ['#b39ddb', '#ce93d8', '#c4b5fd', '#e6e6fa'],
    magenta: ['#d81b9a', '#ff00ff', '#ff1493', '#c2185b'],
    pink: ['#f06292', '#e91e63', '#ec407a', '#ff69b4', '#f472b6'],
    lightPink: ['#f8bbd0', '#ffc0cb', '#fbcfe8'],
    brown: ['#6d4c41', '#795548', '#a0522d', '#8b4513', '#5d4037'],
    beige: ['#c2a878', '#b5a06a', '#d7c4a3', '#f5f5dc', '#e8d8b8', '#d2b48c'],
    grey: ['#9e9e9e', '#888888', '#808080', '#9ca3af'],
    lightGrey: ['#d4d4d4', '#c0c0c0', '#bdbdbd', '#cfcfcf', '#e0e0e0'],
    darkGrey: ['#424242', '#4b5563', '#555555'],
    black: ['#1a1a1a', '#000000', '#212121', '#18181b'],
    white: ['#f7f7f7', '#ffffff', '#fafafa'],
} as const

export type ColorName = keyof typeof NAMED_COLORS

function oklab(hex: string): [number, number, number] {
    const [red, green, blue] = (parseHexColor(hex) ?? [0, 0, 0]).map(
        (channel) => {
            const c = channel / 255
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        },
    ) as [number, number, number]
    const l = Math.cbrt(
        0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
    )
    const m = Math.cbrt(
        0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
    )
    const s = Math.cbrt(
        0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
    )
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

let referenceColors: [ColorName, [number, number, number]][] | null = null

export function nearestColorName(
    color: string | null | undefined,
): ColorName | null {
    const hex = toHex6(color)
    if (!hex) return null
    referenceColors ??= (
        Object.entries(NAMED_COLORS) as [ColorName, readonly string[]][]
    ).flatMap(([name, shades]) =>
        shades.map((shade): [ColorName, [number, number, number]] => [
            name,
            oklab(toHex6(shade)),
        ]),
    )
    const origin = oklab(hex)
    let best: ColorName = 'grey'
    let bestDistance = Infinity
    for (const [name, reference] of referenceColors) {
        const distance = oklabDistance(origin, reference)
        if (distance < bestDistance) {
            best = name
            bestDistance = distance
        }
    }
    return best
}

export function translatedColorName(
    t: (key: string) => string,
    color: string | null | undefined,
): string {
    const name = nearestColorName(color)
    return name ? t(`colors.${name}`) : ''
}

export function renamedForColor(
    t: (key: string) => string,
    name: string,
    previousColor: string,
    nextColor: string,
): string {
    const automatic =
        !name.trim() || name === translatedColorName(t, previousColor)
    return automatic ? translatedColorName(t, nextColor) : name
}

function oklabDistance(
    a: [number, number, number],
    b: [number, number, number],
) {
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

export function nearestColors(
    target: string,
    pool: readonly string[],
    limit: number,
): string[] {
    const hex = toHex6(target)
    if (!hex) return []
    const origin = oklab(hex)
    return pool
        .filter((color) => toHex6(color) !== hex)
        .map((color) => ({
            color,
            distance: oklabDistance(origin, oklab(color)),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map(({ color }) => color)
}
