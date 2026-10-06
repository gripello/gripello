interface Bucket {
    r: number
    g: number
    b: number
    count: number
}

const MIN_DISTANCE = 72

const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0')

function saturation({ r, g, b }: Bucket) {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return max === 0 ? 0 : (max - min) / max
}

const distance = (a: Bucket, b: Bucket) =>
    Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)

export function paletteFromPixels(
    pixels: ArrayLike<number>,
    count = 3,
): string[] {
    const buckets = new Map<number, Bucket>()
    for (let i = 0; i + 3 < pixels.length; i += 4) {
        if (pixels[i + 3]! < 128) continue
        const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
        const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 }
        bucket.r += r
        bucket.g += g
        bucket.b += b
        bucket.count += 1
        buckets.set(key, bucket)
    }
    const colors = [...buckets.values()]
        .map((bucket) => ({
            r: bucket.r / bucket.count,
            g: bucket.g / bucket.count,
            b: bucket.b / bucket.count,
            count: bucket.count,
        }))
        .sort(
            (a, b) =>
                b.count * (0.3 + saturation(b)) -
                a.count * (0.3 + saturation(a)),
        )
    const picked: Bucket[] = []
    for (const color of colors) {
        if (picked.every((other) => distance(color, other) >= MIN_DISTANCE))
            picked.push(color)
        if (picked.length === count) break
    }
    return picked.map(({ r, g, b }) => `#${hex(r)}${hex(g)}${hex(b)}`)
}

export function paletteGradient(colors: string[]): string | null {
    if (!colors.length) return null
    const stops = colors.length === 1 ? [colors[0], colors[0]] : colors
    return `linear-gradient(120deg, ${stops.join(', ')})`
}
