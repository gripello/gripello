// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import {
    drawGradeScalePdf,
    gradeWheel,
    headerLines,
    routeWheel,
    difficultyShade,
    translator,
} from '../../server/utils/gradeScalePdf'
import { pdfBuffer } from '../../server/utils/export'
import de from '../../i18n/locales/de.json'
import { gymBandsFrom } from '../../shared/utils/gradeReference'

const t = translator(de)

describe('translator', () => {
    it('resolves nested keys and fills placeholders', () => {
        expect(t('gradeConversion.easy')).toBe('Leicht')
        expect(t('gradeConversion.andUp', { grade: '7A' })).toContain('7A')
        expect(t('gradeConversion.missing')).toBe('gradeConversion.missing')
    })
})

describe('gradeWheel', () => {
    it('starts easy at the top and stops a few grades into the last band', () => {
        const { spokes, arcs } = gradeWheel(
            gymBandsFrom([
                { name: 'Grün', color: '#22c55e', to: '5' },
                { name: 'Lila', color: '#a855f7', to: '8C+' },
            ]),
        )

        expect(spokes).toHaveLength(12)
        expect(spokes[0]).toEqual({ label: '<2', angle: -90 })
        expect(spokes.at(-1)).toEqual({ label: '6C+', angle: 240 })
        expect(arcs).toEqual([
            { color: '#22c55e', from: -105, to: 45, ring: 0 },
            { color: '#a855f7', from: 45, to: 255, ring: 1 },
        ])
    })

    it('ends the default scale at 8A', () => {
        expect(gradeWheel(gymBandsFrom(null)).spokes.at(-1)!.label).toBe('8A')
    })
})

describe('headerLines', () => {
    it('leads with the unit and moves the gym name up when there is none', () => {
        expect(headerLines({ unitName: 'Halle', gymName: 'Verein' })).toEqual([
            'Halle',
            'Verein',
        ])
        expect(headerLines({ unitName: '', gymName: 'Verein' })).toEqual([
            'Verein',
            '',
        ])
    })
})

describe('routeWheel', () => {
    it('rings UIAA, French and YDS on one IRCRA sweep from the top', () => {
        const { start, end, segments } = routeWheel()
        expect(start).toBe(-90)
        expect(end).toBe(240)
        const at = (ring: number, label: string) =>
            segments.find((s) => s.ring === ring && s.label === label)!
        expect(at(0, '8').from).toBeLessThan(at(1, '7a').to)
        expect(at(0, '8').to).toBeGreaterThan(at(1, '7a').from)
        expect(segments.filter((s) => s.ring === 2)).toHaveLength(32)
    })

    it('shades from light to dark with difficulty', () => {
        expect(difficultyShade(0)).toBe('#F3F4F6')
        expect(difficultyShade(1)).toBe('#111827')
        const { segments } = routeWheel()
        expect(segments[0]!.shade).not.toBe(segments.at(-1)!.shade)
    })
})

describe('drawGradeScalePdf', () => {
    it.each(['boulders', 'routes'] as const)(
        'renders %s on a single page',
        async (kind) => {
            const doc = new PDFDocument({ size: 'A4', margin: 0 })
            doc.registerFont(
                'Sans',
                readFileSync('server/assets/fonts/Roboto-Regular.ttf'),
            )
            doc.registerFont(
                'Sans-Bold',
                readFileSync('server/assets/fonts/Roboto-Bold.ttf'),
            )

            const pdf = await pdfBuffer(doc, () =>
                drawGradeScalePdf(doc, {
                    kind,
                    title: 'Boulder',
                    gymName: 'Verein',
                    unitName: 'Halle',
                    footer: 'gripello.app/halle',
                    logo: Buffer.from('not an image'),
                    bands: gymBandsFrom(null),
                    t,
                }),
            )

            expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
            expect(
                pdf.toString('latin1').match(/\/Type \/Page\b/g),
            ).toHaveLength(1)
        },
    )
})
