// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener } from 'h3'
import { ofetch } from 'ofetch'
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import xlsxExport from '../../server/api/ui/xlsx'
import pdfExport from '../../server/api/ui/pdf'
import { MAX_TAG_ROUTES } from '../../shared/utils/routeExport'

const ROUTES = Array.from({ length: 5 }, (_, index) => ({
    id: `r${index + 1}`,
    gym: 'gymA',
    name: `Route ${index + 1}`,
    grade: '6a',
    color: '#ff0000',
    type: 'Boulder',
    creator: ['Ann'],
    expand: { location: { name: 'Hall' }, wall: { name: 'North' } },
}))

const fontFiles: Record<string, Buffer> = {
    'fonts/Roboto-Regular.ttf': readFileSync(
        'server/assets/fonts/Roboto-Regular.ttf',
    ),
    'fonts/Roboto-Bold.ttf': readFileSync(
        'server/assets/fonts/Roboto-Bold.ttf',
    ),
}

let permissions: string[] = []
const goRequests: string[] = []
let goApi: Server
let nuxt: Server
let base = ''
let goBase = ''

async function listen(server: Server) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
    goApi = createServer((req, res) => {
        const url = new URL(req.url!, 'http://go')
        goRequests.push(url.pathname)
        const json = (body: unknown) => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(body))
        }
        if (url.pathname === '/api/me/memberships')
            return json([{ gym: { id: 'gymA' }, role: { permissions } }])
        if (url.pathname === '/api/gyms/gymA')
            return json({ id: 'gymA', name: 'Gym A', sign_image: 'logo.png' })
        if (url.pathname === '/api/gyms/gymA/routes') {
            const ids = url.searchParams.get('ids')!.split(',')
            return json({ items: ROUTES.filter((r) => ids.includes(r.id)) })
        }
        res.writeHead(404).end()
    })
    goBase = await listen(goApi)
    nuxt = createServer(
        toNodeListener(
            createApp().use('/xlsx', xlsxExport).use('/pdf', pdfExport),
        ),
    )
    base = await listen(nuxt)
})

afterAll(() => {
    goApi.close()
    nuxt.close()
})

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.assign(globalThis.$fetch, { create: ofetch.create })
    globalThis.__NUXT_RUNTIME_CONFIG__ = { apiBase: goBase, public: {} }
    vi.stubGlobal('useStorage', () => ({
        getItemRaw: async (key: string) => fontFiles[key] ?? null,
    }))
    permissions = ['manage_routes']
    goRequests.length = 0
})

const post = (
    kind: 'xlsx' | 'pdf',
    body: unknown,
    token: string | null = 'tok',
) =>
    fetch(`${base}/${kind}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    })

const pageCount = (pdf: Buffer) =>
    pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0

describe.each(['xlsx', 'pdf'] as const)('%s route export', (kind) => {
    it('requires a gym, a session and manage_routes there', async () => {
        expect((await post(kind, { ids: ['r1'] })).status).toBe(400)
        expect(
            (await post(kind, { gym: 'gymA', ids: ['r1'] }, null)).status,
        ).toBe(401)
        expect((await post(kind, { gym: 'gymB', ids: ['r1'] })).status).toBe(
            403,
        )
        permissions = ['manage_tasks']
        expect((await post(kind, { gym: 'gymA', ids: ['r1'] })).status).toBe(
            403,
        )
        expect(goRequests.every((path) => path === '/api/me/memberships')).toBe(
            true,
        )
    })

    it('refuses an export without routes', async () => {
        expect((await post(kind, { gym: 'gymA', ids: [' '] })).status).toBe(400)
        expect(goRequests).not.toContain('/api/gyms/gymA/routes')
    })
})

describe('xlsx route export', () => {
    it('writes the chosen columns for the requested routes in order', async () => {
        const res = await post('xlsx', {
            gym: 'gymA',
            ids: ['r3', 'missing', 'r1', 'r3'],
            columns: ['name', 'type', 'location', 'bogus', 'name'],
            labels: { name: 'Titel', sheet: 'Routen: Halle/1' },
            typeLabels: { Boulder: 'Bouldern' },
        })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        expect(res.headers.get('content-disposition')).toMatch(
            /^attachment; filename="climbing-routes-\d+\.xlsx"$/,
        )

        const { Workbook } = await import('@cj-tech-master/excelts')
        const workbook = new Workbook()
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()))
        const sheet = workbook.worksheets[0]!
        expect(sheet.name).toBe('Routen Halle1')
        const rows: unknown[][] = []
        sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)))
        expect(rows).toEqual([
            ['Titel', 'Type', 'Location'],
            ['Route 3', 'Bouldern', 'Hall'],
            ['Route 1', 'Bouldern', 'Hall'],
        ])
    })

    it('adds a QR image per route when asked for', async () => {
        const res = await post('xlsx', {
            gym: 'gymA',
            ids: ['r1', 'r2'],
            columns: ['name', 'qr'],
        })
        const { Workbook } = await import('@cj-tech-master/excelts')
        const workbook = new Workbook()
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()))
        expect(workbook.worksheets[0]!.getImages()).toHaveLength(2)
    })
})

describe('pdf tag export', () => {
    it('falls back to the standard layout and skips a hidden logo', async () => {
        const standard = await post('pdf', {
            gym: 'gymA',
            ids: ROUTES.map((route) => route.id),
            template: 'nonsense',
            show: { logo: false },
        })
        expect(standard.status).toBe(200)
        expect(standard.headers.get('content-type')).toBe('application/pdf')
        const pdf = Buffer.from(await standard.arrayBuffer())
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(pageCount(pdf)).toBe(1)
        expect(goRequests.some((path) => path.startsWith('/api/files/'))).toBe(
            false,
        )
    }, 30_000)

    it('honours the large layout and fetches the logo when shown', async () => {
        const large = await post('pdf', {
            gym: 'gymA',
            ids: ROUTES.map((route) => route.id),
            template: 'large',
        })
        expect(pageCount(Buffer.from(await large.arrayBuffer()))).toBe(2)
        expect(goRequests).toContain('/api/files/gyms/gymA/logo.png')
    }, 30_000)

    it('refuses more tags than one export may hold', async () => {
        const ids = Array.from(
            { length: MAX_TAG_ROUTES + 1 },
            (_, index) => `r${index}`,
        )
        expect((await post('pdf', { gym: 'gymA', ids })).status).toBe(400)
    })

    it('answers 500 when the fonts are missing', async () => {
        vi.stubGlobal('useStorage', () => ({ getItemRaw: async () => null }))
        expect((await post('pdf', { gym: 'gymA', ids: ['r1'] })).status).toBe(
            500,
        )
    })
})
