import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationsDir = 'pocketbase/pb_migrations'

describe('docker nginx config', () => {
    it('accepts request bodies as large as the largest PocketBase file field', () => {
        const largestMaxSize = Math.max(
            ...readdirSync(migrationsDir).flatMap((file) =>
                [
                    ...readFileSync(
                        `${migrationsDir}/${file}`,
                        'utf8',
                    ).matchAll(/maxSize: (\d+)/g),
                ].map((match) => Number(match[1])),
            ),
        )
        const bodyLimitMb = readFileSync('.docker/nginx.conf', 'utf8').match(
            /client_max_body_size (\d+)m;/,
        )?.[1]

        expect(Number(bodyLimitMb) * 1024 * 1024).toBeGreaterThan(
            largestMaxSize,
        )
    })
})
