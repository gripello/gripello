import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = readFileSync(join(__dirname, '../../.docker/nginx.conf'), 'utf8')

describe('nginx MIME types', () => {
    it('serves .mjs as JavaScript, so module workers like MapLibre start', () => {
        expect(config).toMatch(
            /types\s*\{[^}]*application\/javascript\s+[^;]*\bmjs\b/,
        )
    })
})
