import { clipBands, groupBands, scaleBands } from '~/utils/gradeLadder'

describe('gradeLadder', () => {
    it('places grade boundaries halfway between neighbouring IRCRA values', () => {
        const uiaa = scaleBands('uiaa')
        const at = (label: string) => uiaa.find((band) => band.label === label)!
        expect(at('7-').lo).toBeCloseTo((11 + 12.1) / 2)
        expect(at('7-').hi).toBeCloseTo((12.1 + 13.4) / 2)
        expect(at('11-').lo).toBeGreaterThan(26)
        expect(uiaa[0]!.lo).toBeCloseTo(1 - 0.45)
        expect(uiaa.at(-1)!.hi).toBeCloseTo(32.1 + 0.55)
    })

    it('keeps scales out of step with each other', () => {
        const uiaa = scaleBands('uiaa').map((band) => band.lo)
        const french = scaleBands('french').map((band) => band.lo)
        expect(uiaa.filter((lo) => french.includes(lo)).length).toBeLessThan(3)
    })

    it('merges spans of bands into one band', () => {
        const font = scaleBands('font')
        expect(
            groupBands(font, [
                { label: 'a', span: 2 },
                { label: 'b', span: 99 },
            ]),
        ).toEqual([
            { label: 'a', lo: font[0]!.lo, hi: font[1]!.hi },
            { label: 'b', lo: font[2]!.lo, hi: font.at(-1)!.hi },
        ])
    })

    it('clips bands to a range and drops the ones outside it', () => {
        expect(
            clipBands(
                [
                    { label: 'out', lo: 0, hi: 1 },
                    { label: 'cut', lo: 1.5, hi: 3 },
                    { label: 'in', lo: 3, hi: 4 },
                ],
                2,
                3.5,
            ),
        ).toEqual([
            { label: 'cut', lo: 2, hi: 3 },
            { label: 'in', lo: 3, hi: 3.5 },
        ])
    })
})
