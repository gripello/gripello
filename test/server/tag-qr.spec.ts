import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { TAG_QR_ERROR_CORRECTION } from '../../server/utils/export'

prepareZXingModule({
    overrides: {
        wasmBinary: readFileSync(
            createRequire(import.meta.url).resolve(
                'zxing-wasm/reader/zxing_reader.wasm',
            ),
        ),
    },
})

const TAG_URL =
    'https://routes.example-climbing-gym.de/route?id=k3m9x2q7p1z8r4t'
const QR_SIZE_PT = 110
const CIRCLE_RADIUS_PT = 14.5
const MODULE_PX = 6
const MARGIN_MODULES = 1

function renderTag(url: string) {
    const qr = QRCode.create(url, {
        errorCorrectionLevel: TAG_QR_ERROR_CORRECTION,
    })
    const modules = qr.modules.size
    const size = (modules + MARGIN_MODULES * 2) * MODULE_PX
    const data = new Uint8ClampedArray(size * size * 4).fill(255)
    const center = size / 2
    const circleRadius = (CIRCLE_RADIUS_PT / QR_SIZE_PT) * size

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const moduleX = Math.floor(x / MODULE_PX) - MARGIN_MODULES
            const moduleY = Math.floor(y / MODULE_PX) - MARGIN_MODULES
            const insideCode =
                moduleX >= 0 &&
                moduleY >= 0 &&
                moduleX < modules &&
                moduleY < modules
            const dark =
                insideCode && qr.modules.data[moduleY * modules + moduleX]
            const underCircle =
                Math.hypot(x - center, y - center) <= circleRadius
            if (dark && !underCircle) {
                const offset = (y * size + x) * 4
                data[offset] = data[offset + 1] = data[offset + 2] = 0
            }
        }
    }
    return { image: new ImageData(data, size, size), modules }
}

describe('route tag QR code', () => {
    it('still decodes with the color circle printed over its center', async () => {
        const { image } = renderTag(TAG_URL)
        const results = await readBarcodes(image, { formats: ['QRCode'] })
        expect(results[0]?.text).toBe(TAG_URL)
    })

    it('uses fewer, larger modules than the highest correction level', () => {
        const { modules } = renderTag(TAG_URL)
        const highest = QRCode.create(TAG_URL, { errorCorrectionLevel: 'H' })
        expect(modules).toBeLessThan(highest.modules.size)
    })
})
