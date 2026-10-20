// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { drawRouteTag } from '../../server/utils/routeTag'
import { attachmentHeader, pdfBuffer } from '../../server/utils/export'
import { drawGradeScalePdf, translator } from '../../server/utils/gradeScalePdf'
import { gymBandsFrom } from '../../shared/utils/gradeReference'
import type { RouteRecord } from '../../types/models'
import en from '../../i18n/locales/en.json'

const NAMES = {
    emoji: '🧗‍♀️ Crimp 🔥🧗🏽 Party 👨‍👩‍👧',
    cjk: '攀岩路线 クライミング 등반',
    arabic: 'طريق التسلق الصعب',
    combining: 'Café Z̶̡̛a̷l̴g̸o̵ ñ',
    long: 'Ü🧗'.repeat(50),
}

const api = vi.hoisted(() => ({ responses: {} as Record<string, unknown> }))
vi.mock('../../server/utils/api-server', () => {
    const fetcher = async (path: string) => {
        if (!(path in api.responses)) throw new Error(`unexpected ${path}`)
        return api.responses[path]
    }
    return {
        apiFetch: () => fetcher,
        requirePermission: async () => fetcher,
        fetchFile: async () => null,
    }
})

function fontedDocument(options: PDFKit.PDFDocumentOptions = {}) {
    const doc = new PDFDocument(options)
    doc.registerFont(
        'Sans',
        readFileSync('server/assets/fonts/Roboto-Regular.ttf'),
    )
    doc.registerFont(
        'Sans-Bold',
        readFileSync('server/assets/fonts/Roboto-Bold.ttf'),
    )
    return doc
}

const isPdf = (pdf: Buffer) =>
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

describe.each(Object.entries(NAMES))('PDF exports with %s text', (_, text) => {
    it('draws a route tag', async () => {
        const doc = fontedDocument({ size: 'A4' })
        const png = await QRCode.toBuffer('https://example.com/route?id=abc')
        const route = {
            id: 'abc',
            name: text,
            comment: `${text} ${text}`,
            grade: '7a',
            grade_system: 'font',
            type: 'Boulder',
            creator: [text, text],
            screw_date: '2026-03-04',
            color: '#ff0000',
        } as unknown as RouteRecord
        isPdf(
            await pdfBuffer(doc, () =>
                drawRouteTag(doc, route, 20, 30, {
                    anchorLabel: text,
                    locale: 'en',
                    qrCode: png,
                    logo: png,
                    show: { creators: true, date: true, logo: true },
                }),
            ),
        )
    })

    it('draws the grade scale', async () => {
        const doc = fontedDocument({ size: 'A4', margin: 0 })
        isPdf(
            await pdfBuffer(doc, () =>
                drawGradeScalePdf(doc, {
                    title: text,
                    gymName: text,
                    unitName: text,
                    footer: text,
                    logo: null,
                    bands: gymBandsFrom(null),
                    t: translator(en),
                }),
            ),
        )
    })

    it('names the download', () => {
        expect(attachmentHeader(`${text}.pdf`)).toMatch(
            /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/,
        )
    })
})

describe('competition export with unicode names', () => {
    const fontFiles: Record<string, Buffer> = {
        'fonts/Roboto-Regular.ttf': readFileSync(
            'server/assets/fonts/Roboto-Regular.ttf',
        ),
        'fonts/Roboto-Bold.ttf': readFileSync(
            'server/assets/fonts/Roboto-Bold.ttf',
        ),
    }

    beforeEach(() => {
        vi.stubGlobal('useStorage', () => ({
            getItemRaw: async (key: string) => fontFiles[key] ?? null,
        }))
        const rows = Object.values(NAMES).map((name, index) => ({
            entry: `e${index}`,
            rank: index + 1,
            bib: index + 1,
            name,
            points: 100 - index,
            tops: 3,
            zones: 4,
        }))
        api.responses = {
            '/competitions/c1': {
                id: 'c1',
                gym: 'g1',
                name: NAMES.long,
                starts_at: '2026-03-04T09:00:00.000Z',
                ends_at: '2026-03-04T18:00:00.000Z',
            },
            '/gyms/g1': { id: 'g1', name: NAMES.cjk },
            '/competitions/c1/standings': {
                visibility: 'public',
                format: 'points',
                updated: '',
                categories: [{ id: 'k1', name: NAMES.arabic, rows }],
            },
        }
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const labels = {
        title: NAMES.emoji,
        certificate: NAMES.combining,
        place: '{rank}. {category}',
        rank: '#',
        bib: 'Bib',
        name: 'Name',
        tops: 'Tops',
        zones: 'Zones',
        points: 'Points',
        category: 'Category',
        birthYear: 'Year',
        status: 'Status',
        paid: 'Paid',
        yes: 'yes',
        no: 'no',
        anonymous: 'Anonymous',
        statuses: {},
    }

    it.each(['results', 'certificates'])('renders %s', async (kind) => {
        vi.resetModules()
        vi.doMock('h3', async (original) => ({
            ...(await original<typeof import('h3')>()),
            readBody: async () => ({ id: 'c1', kind, format: 'pdf', labels }),
            setResponseHeaders: () => {},
        }))
        const { default: handler } =
            await import('../../server/api/ui/competition-export.post')
        const pdf = (await handler({} as never)) as Buffer
        isPdf(pdf)
    })
})
