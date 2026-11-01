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
import gradeScale from '../../server/api/ui/grade-scale.get'

const assets: Record<string, Buffer> = {
    'fonts/Roboto-Regular.ttf': readFileSync(
        'server/assets/fonts/Roboto-Regular.ttf',
    ),
    'fonts/Roboto-Bold.ttf': readFileSync(
        'server/assets/fonts/Roboto-Bold.ttf',
    ),
}
const locales: Record<string, object> = {
    'en.json': JSON.parse(readFileSync('i18n/locales/en.json', 'utf8')),
    'de.json': JSON.parse(readFileSync('i18n/locales/de.json', 'utf8')),
}

const gyms: Record<string, object> = {
    gymA: {
        id: 'gymA',
        slug: 'gym-a',
        name: 'Gym A',
        language: 'de',
        sign_image: 'sign.png',
        page_logo: 'page.png',
        boulder_bands: [{ name: 'Grün', color: '#22c55e', to: '5' }],
    },
    gymB: {
        id: 'gymB',
        slug: 'gym-b',
        name: 'Gym B',
        language: 'klingon',
        page_logo: 'page.png',
    },
}
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
        const path = new URL(req.url!, 'http://go').pathname
        goRequests.push(path)
        const gym = gyms[path.replace('/api/gyms/', '')]
        if (gym) {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(gym))
            return
        }
        res.writeHead(404).end()
    })
    goBase = await listen(goApi)
    nuxt = createServer(toNodeListener(createApp().use(gradeScale)))
    base = await listen(nuxt)
})

afterAll(() => {
    goApi.close()
    nuxt.close()
})

let fontsMissing = false

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.assign(globalThis.$fetch, { create: ofetch.create })
    globalThis.__NUXT_RUNTIME_CONFIG__ = { apiBase: goBase, public: {} }
    fontsMissing = false
    vi.stubGlobal('useStorage', (name: string) =>
        name === 'assets:locales'
            ? { getItem: async (key: string) => locales[key] ?? null }
            : {
                  getItemRaw: async (key: string) =>
                      fontsMissing ? null : (assets[key] ?? null),
              },
    )
    goRequests.length = 0
})

const get = (query: string) => fetch(`${base}/?${query}`)

describe('GET /api/ui/grade-scale', () => {
    it('answers 404 for a missing or unknown gym, asking Go only when one is named', async () => {
        expect((await get('')).status).toBe(404)
        expect(goRequests).toEqual([])
        expect((await get('gym=nope')).status).toBe(404)
        expect(goRequests).toEqual(['/api/gyms/nope'])
    })

    it('renders the boulder scale in the gym language with its sign as logo', async () => {
        const res = await get('gym=gymA')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/pdf')
        expect(res.headers.get('cache-control')).toBe('no-store')
        expect(res.headers.get('content-disposition')).toContain(
            'filename="Gym-A-Boulder.pdf"',
        )
        const pdf = Buffer.from(await res.arrayBuffer())
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
        expect(goRequests).toContain('/api/files/gyms/gymA/sign.png')
    })

    it('falls back to English and the page logo for routes', async () => {
        const res = await get('gym=gymB&kind=routes')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toContain(
            'filename="Gym-B-Routes.pdf"',
        )
        expect(goRequests).toContain('/api/files/gyms/gymB/page.png')
    })

    it('answers 500 when the fonts are missing', async () => {
        fontsMissing = true
        expect((await get('gym=gymA')).status).toBe(500)
    })
})
