// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import {
    drawGradeScalePdf,
    gradeWheel,
    headerLines,
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

describe('drawGradeScalePdf', () => {
    it('renders a single page', async () => {
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
        expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1)
    })
})
