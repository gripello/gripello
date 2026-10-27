import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NUXT_API_PREFIXES } from '#shared/utils/apiVersion'

describe('docker nginx config', () => {
    it('accepts request bodies as large as the largest upload the api allows', () => {
        const largestMaxSize = Math.max(
            ...globSync('backend/internal/**/*.go').flatMap((file) =>
                [
                    ...readFileSync(file, 'utf8').matchAll(
                        /max\w*(?:Bytes|Size)\s*=\s*(\d+) << 20/g,
                    ),
                ].map((match) => Number(match[1]) << 20),
            ),
        )
        const bodyLimitMb = readFileSync('.docker/nginx.conf', 'utf8').match(
            /client_max_body_size (\d+)m;/,
        )?.[1]

        expect(Number(bodyLimitMb) * 1024 * 1024).toBeGreaterThan(
            largestMaxSize,
        )
    })

    it('lets every worker hold its connections and their upstream sockets', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const connections = Number(
            config.match(/worker_connections (\d+);/)?.[1],
        )
        const files = Number(config.match(/worker_rlimit_nofile (\d+);/)?.[1])

        expect(connections).toBeGreaterThanOrEqual(8192)
        expect(files).toBeGreaterThanOrEqual(2 * connections)
    })

    it('keeps SSR pages in memory instead of spilling them to temp files', () => {
        const [, count, sizeKb] =
            readFileSync('.docker/nginx.conf', 'utf8').match(
                /proxy_buffers (\d+) (\d+)k;/,
            ) ?? []

        expect(Number(count) * Number(sizeKb)).toBeGreaterThanOrEqual(512)
    })

    it('lets signage players frame the TV screen and nothing else', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const tv = config.match(
            /location ~ \^\/\[a-z0-9-\]\+\/tv\$ \{([^}]*)\}/,
        )?.[1]
        expect(tv).toBeDefined()
        expect(tv).not.toContain('frame-ancestors')
        expect(tv).toContain('Strict-Transport-Security')
        expect(tv).toMatch(/proxy_pass http:\/\/nuxt;/)
    })

    it('forbids framing and pins HTTPS on every response, also where a location adds its own headers', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const tls = config.slice(config.indexOf('listen 443 ssl;'))
        expect(tls).toMatch(
            /\n {8}add_header Content-Security-Policy "frame-ancestors 'none'" always;/,
        )
        expect(tls).toMatch(
            /\n {8}add_header Strict-Transport-Security "max-age=\d+" always;/,
        )
        const withOwnHeaders = [...tls.matchAll(/location [^{]+\{([^}]*)\}/g)]
            .filter(([, body]) => /add_header/.test(body!))
            .filter(([block]) => !block.includes('/tv$'))
        expect(withOwnHeaders.length).toBeGreaterThan(0)
        for (const [block, body] of withOwnHeaders) {
            expect(body, block.split('\n')[0]).toContain(
                "frame-ancestors 'none'",
            )
            expect(body, block.split('\n')[0]).toContain(
                'Strict-Transport-Security',
            )
        }
    })

    it('rate-limits every api location, including the ones served by Nuxt', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const unlimited = [
            ...config.matchAll(/location (?:= |~ )?(\S*api\S*) \{([^}]*)\}/g),
        ]
            .filter(([, , body]) => !/limit_req zone=api/.test(body!))
            .map(([, path]) => path)

        expect(unlimited).toEqual([])
    })

    it('sends exactly the Nuxt api prefixes to Nuxt', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const toNuxt = [
            ...config.matchAll(/location (?:= )?(\/api\/[^\s{]*) \{([^}]*)\}/g),
        ]
            .filter(([, , body]) =>
                /proxy_pass http:\/\/(nuxt|127\.0\.0\.1:3000)/.test(body!),
            )
            .map(([, path]) => path)

        expect(toNuxt.sort()).toEqual([...NUXT_API_PREFIXES].sort())
    })
})
