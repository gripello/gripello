import QRCode from 'qrcode'
import { qrSvg } from '~/utils/qrDataUrl'

describe('qrSvg', () => {
    const qr = QRCode.create('https://gripello.app/e2e', {
        errorCorrectionLevel: 'M',
    })
    const svg = qrSvg(qr)

    it('draws three rounded finder eyes and joins runs of modules into bars', () => {
        expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(3)
        const darkOutsideFinders =
            qr.modules.data.filter(Boolean).length - 3 * 33
        const bars = svg.match(/rx="0.44"/g)!.length
        expect(bars).toBeGreaterThan(0)
        expect(bars).toBeLessThan(darkOutsideFinders)
    })

    it('keeps a one-module quiet zone around the code', () => {
        const size = qr.modules.size
        expect(svg).toContain(`viewBox="-1 -1 ${size + 2} ${size + 2}"`)
    })
})
