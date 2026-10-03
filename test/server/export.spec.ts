import { describe, expect, it, vi } from 'vitest'
import {
    attachmentHeader,
    resolveApplicationUrl,
    resolveExportGymId,
    resolveExportColumns,
    resolveRouteIds,
    requireRouteIds,
    pdfBuffer,
} from '../../server/utils/export'
import PDFDocument from 'pdfkit'

vi.mock('h3', async () => {
    return {
        readBody: async (event: any) => {
            if (event.body === undefined) {
                throw new Error('no body')
            }
            return event.body
        },
        getRequestURL: (
            event: any,
            options: { xForwardedHost?: boolean } = {},
        ) =>
            new URL(
                `https://${(options.xForwardedHost && event?.headers?.['x-forwarded-host']) || 'request.example'}/manage/routes`,
            ),
        createError: (input: { statusMessage: string }) =>
            Object.assign(new Error(input.statusMessage), input),
    }
})

const eventWith = (body: unknown) => ({
    body,
    context: {} as Record<string, unknown>,
})

describe('resolveExportColumns', () => {
    it('falls back to every column but the QR code when none are requested', async () => {
        const columns = await resolveExportColumns(eventWith({ ids: ['a'] }))

        expect(columns.map((column) => column.key)).toEqual([
            'color',
            'name',
            'difficulty',
            'anchor_point',
            'comment',
            'creator',
            'location',
            'wall',
            'type',
            'screw_date',
        ])
    })

    it('renders the columns in the requested order', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['qr', 'difficulty', 'name'] }),
        )

        expect(columns.map((column) => column.key)).toEqual([
            'qr',
            'difficulty',
            'name',
        ])
    })

    it('drops unknown and duplicate keys', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['name', '__proto__', 'nope', 'name'] }),
        )

        expect(columns.map((column) => column.key)).toEqual(['name'])
    })

    it('exports the grade label as text', async () => {
        const [difficulty] = await resolveExportColumns(
            eventWith({ columns: ['difficulty'] }),
        )

        expect(
            difficulty.value!({ grade: '6a+', grade_system: 'french' }),
        ).toBe('6a+')
    })

    it('prefers client labels over the default headers', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['name'], labels: { name: 'Nombre' } }),
        )

        expect(columns[0].header).toBe('Nombre')
    })

    it('ignores blank or non-string labels', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['name'], labels: { name: '  ' } }),
        )

        expect(columns[0].header).toBe('Name')
    })

    it('writes the translated route type', async () => {
        const [type] = await resolveExportColumns(
            eventWith({
                columns: ['type'],
                typeLabels: { Boulder: 'Bouldern', Route: 'Route' },
            }) as never,
        )
        expect(type!.value!({ type: 'Boulder' } as never)).toBe('Bouldern')
        expect(type!.value!({ type: 'Other' } as never)).toBe('Other')
    })

    it('renders creator values regardless of the stored shape', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['creator'] }),
        )

        expect(columns[0].value!({ creator: 'Max, Moritz' })).toBe(
            'Max, Moritz',
        )
        expect(columns[0].value!({ creator: ['Max', 'Moritz'] })).toBe(
            'Max, Moritz',
        )
        expect(columns[0].value!({ creator: null })).toBe('')
    })
})

describe('resolveRouteIds', () => {
    it('reads ids from the body and reuses the cached body afterwards', async () => {
        const event = eventWith({ ids: [' a ', '', 'b'], columns: ['name'] })

        expect(await resolveRouteIds(event)).toEqual(['a', 'b'])

        // second read must not consume the stream again
        event.body = undefined
        expect((await resolveExportColumns(event))[0].key).toBe('name')
    })

    it('ignores the query string', async () => {
        expect(await resolveRouteIds(eventWith(undefined))).toEqual([])
    })

    it('drops duplicate ids', async () => {
        expect(
            await resolveRouteIds(eventWith({ ids: ['a', 'b', 'a', ' b'] })),
        ).toEqual(['a', 'b'])
    })
})

describe('requireRouteIds', () => {
    it('rejects an empty selection', () => {
        expect(() => requireRouteIds([])).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        )
    })

    it('rejects more ids than allowed', () => {
        expect(() => requireRouteIds(['a', 'b'], 1)).toThrow(
            expect.objectContaining({ statusCode: 400 }),
        )
        expect(requireRouteIds(['a'], 1)).toEqual(['a'])
    })
})

describe('pdfBuffer', () => {
    it('returns the whole document after async drawing', async () => {
        const doc = new PDFDocument()
        const pdf = await pdfBuffer(doc, async () => {
            await Promise.resolve()
            doc.text('Tag')
        })
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
    })

    it('returns a valid document without routes', async () => {
        const pdf = await pdfBuffer(new PDFDocument(), () => {})
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    })
})

describe('resolveApplicationUrl', () => {
    it('uses the request origin', () => {
        expect(resolveApplicationUrl({} as never)).toBe(
            'https://request.example',
        )
    })

    it('ignores a forwarded host', () => {
        expect(
            resolveApplicationUrl({
                headers: { 'x-forwarded-host': 'evil.example' },
            } as never),
        ).toBe('https://request.example')
    })
})

describe('resolveExportGymId', () => {
    it('reads the gym from the body', async () => {
        expect(await resolveExportGymId(eventWith({ gym: ' g1 ' }))).toBe('g1')
    })

    it('rejects a missing gym', async () => {
        await expect(resolveExportGymId(eventWith({}))).rejects.toMatchObject({
            statusCode: 400,
        })
    })
})

describe('wall column', () => {
    it('reads the expanded wall name', async () => {
        const columns = await resolveExportColumns(
            eventWith({ columns: ['wall'] }),
        )
        const route = { expand: { wall: { name: 'Cave' } } }
        expect(columns[0]!.value!(route as never, 'en')).toBe('Cave')
        expect(columns[0]!.value!({} as never, 'en')).toBe('')
    })
})

describe('attachmentHeader', () => {
    it('keeps the header ASCII and carries the real name encoded', () => {
        const header = attachmentHeader('Кубок Jäm-results.pdf')
        expect(header).toMatch(/^[\x20-\x7e]+$/)
        expect(header).toContain('filename="Jam-results.pdf"')
        expect(header).toContain(
            `filename*=UTF-8''${encodeURIComponent('Кубок Jäm-results.pdf')}`,
        )
    })

    it('falls back to a generic name when nothing ASCII is left', () => {
        expect(attachmentHeader('Кубок')).toContain('filename="export"')
    })
})
