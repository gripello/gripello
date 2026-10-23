import { decodeText } from '~/utils/decodeText'

const bytes = (...values: number[]) => new Uint8Array(values).buffer

describe('decodeText', () => {
    it('reads UTF-8 and drops its byte order mark', () => {
        expect(
            decodeText(bytes(0xef, 0xbb, 0xbf, 0x4d, 0xc3, 0xbc, 0x6c)),
        ).toBe('Mül')
    })

    it('falls back to Windows-1252 for Excel CSV exports', () => {
        expect(decodeText(bytes(0x4d, 0xfc, 0x6c, 0x3b, 0x80))).toBe('Mül;€')
    })
})
