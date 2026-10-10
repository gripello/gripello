import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
})
