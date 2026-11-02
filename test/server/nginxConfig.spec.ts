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

    it('keeps query strings, referers and the tokens of e-mailed links out of the access log', () => {
        const config = readFileSync('.docker/nginx.conf', 'utf8')
        const format = config.match(/log_format main ([^;]+);/)?.[1] ?? ''
        expect(format).toContain('$log_path')
        expect(format).not.toMatch(
            /\$(request|request_uri|uri|args|query_string|http_referer)\b/,
        )
        const map = (source: string, target: string) => {
            const [, pattern = '', value = ''] =
                config.match(
                    new RegExp(
                        `map \\$${source} \\$${target} \\{\\s*"~([^"]+)" "?([^";]+)"?;`,
                    ),
                ) ?? []
            return (input: string) => {
                const groups = input.match(new RegExp(pattern))?.groups
                if (!groups) return input
                return value.replace(
                    /\$\{?(\w+)\}?/g,
                    (_, name: string) => groups[name] ?? '',
                )
            }
        }
        const withoutQuery = map('request_uri', 'log_raw_path')
        const masked = map('log_raw_path', 'log_path')
        const logged = (requestUri: string) => masked(withoutQuery(requestUri))

        const pages = globSync('app/pages/**/*.vue')
            .filter((file) => file.includes('[token]'))
            .map((file) =>
                file
                    .replace(/^app\/pages/, '')
                    .replace(/\.vue$/, '')
                    .replace('[token]', 'SECRET'),
            )
        const apiPaths = globSync('api/*.yaml').flatMap((file) =>
            [
                ...readFileSync(file, 'utf8').matchAll(
                    /^ {2,4}(\/[^:\s]*\{(?:token|key)\}[^:\s]*):/gm,
                ),
            ].map(
                ([, path = '']) =>
                    '/api' +
                    path
                        .replace(/\{(token|key)\}/, 'SECRET')
                        .replace(/\{\w+\}/g, 'x'),
            ),
        )
        expect(pages.length).toBeGreaterThanOrEqual(6)
        expect(apiPaths.length).toBeGreaterThanOrEqual(4)
        for (const path of [...pages, ...apiPaths]) {
            expect(logged(`${path}?next=%2F`)).not.toMatch(/SECRET|next=/)
            expect(logged(`${path}/_payload.json`)).toMatch(/\/_payload\.json$/)
        }
        expect(logged('/climbers-hall/routes?id=abc')).toBe(
            '/climbers-hall/routes',
        )
    })

    it('keeps the error log above the levels that print raw request lines', () => {
        const levels = [
            ...readFileSync('.docker/nginx.conf', 'utf8').matchAll(
                /^\s*error_log\s+\S+\s+(\w+);/gm,
            ),
        ].map(([, level]) => level)
        expect(levels.length).toBeGreaterThan(0)
        for (const level of levels)
            expect(['crit', 'alert', 'emerg']).toContain(level)
    })
})
