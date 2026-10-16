import type { QRCode } from 'qrcode'

const QR_INK = '#111827'
const FINDER = 7

const isFinder = (row: number, col: number, size: number) =>
    (row < FINDER || row >= size - FINDER) &&
    (col < FINDER || col >= size - FINDER) &&
    !(row >= size - FINDER && col >= size - FINDER)

function finderEye(x: number, y: number) {
    return (
        `<path fill-rule="evenodd" d="M${x + 2} ${y}h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z` +
        `M${x + 2.2} ${y + 1}h2.6a1.2 1.2 0 0 1 1.2 1.2v2.6a1.2 1.2 0 0 1-1.2 1.2h-2.6a1.2 1.2 0 0 1-1.2-1.2v-2.6a1.2 1.2 0 0 1 1.2-1.2z"/>` +
        `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9"/>`
    )
}

export function qrSvg({ modules }: Pick<QRCode, 'modules'>) {
    const { size, data } = modules
    const dark = (row: number, col: number) =>
        col < size && !!data[row * size + col] && !isFinder(row, col, size)
    const bars: string[] = []
    for (let row = 0; row < size; row++)
        for (let col = 0; col < size; col++) {
            if (!dark(row, col)) continue
            const start = col
            while (dark(row, col + 1)) col++
            bars.push(
                `<rect x="${start + 0.06}" y="${row + 0.06}" width="${col - start + 0.88}" height="0.88" rx="0.44"/>`,
            )
        }
    const eyes = [
        [0, 0],
        [size - FINDER, 0],
        [0, size - FINDER],
    ].map(([x, y]) => finderEye(x!, y!))
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${size + 2} ${size + 2}" shape-rendering="geometricPrecision">` +
        `<g fill="${QR_INK}">${eyes.join('')}${bars.join('')}</g></svg>`
    )
}

export async function qrDataUrl(url: string) {
    const { default: QRCode } = await import('qrcode')
    const svg = qrSvg(QRCode.create(url, { errorCorrectionLevel: 'M' }))
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
