// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import devApiProxy from '../../server/middleware/dev-api-proxy'

const servers: Server[] = []

async function listen(server: Server) {
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(() => {
    servers.splice(0).forEach((server) => server.close())
    vi.unstubAllGlobals()
})

describe('dev API proxy', () => {
    it('hands redirects to the client instead of following them', async () => {
        const goApi = await listen(
            createServer((_, res) => {
                res.writeHead(302, {
                    location: 'app.gripello:/auth/login?oauth2=ticket',
                })
                res.end()
            }),
        )
        vi.stubGlobal('useRuntimeConfig', () => ({ apiBase: goApi }))
        const nuxt = await listen(
            createServer(toNodeListener(createApp().use(devApiProxy))),
        )

        const response = await fetch(
            `${nuxt}/api/auth/oauth2/google/callback?code=x`,
            { redirect: 'manual' },
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe(
            'app.gripello:/auth/login?oauth2=ticket',
        )
    })
})
