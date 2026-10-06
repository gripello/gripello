import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const nginx = readFileSync('.docker/nginx.conf', 'utf8')
const block = (location: string) =>
    nginx.slice(nginx.indexOf(`location ${location} {`)).split('}')[0]!

describe('nginx caching', () => {
    it('serves built assets from disk with their precompressed copies', () => {
        expect(nginx).toContain('root /app/ui/public;')
        expect(nginx).toContain('gzip_static on;')
        expect(block('/_nuxt/')).toContain('try_files $uri @nuxt')
        expect(block('/_nuxt/')).not.toContain('proxy_pass')
    })

    it('lets browsers notice a new build', () => {
        expect(block('= /_nuxt/builds/latest.json')).toContain(
            'add_header Cache-Control "no-cache"',
        )
    })

    it('revalidates translations instead of downloading them on every load', () => {
        expect(block('/_i18n/')).toContain(
            'add_header Cache-Control "no-cache"',
        )
    })

    it('shares public competition results across workers but not staff results', () => {
        const results = block('= /api/ui/competition-results')
        expect(results).toContain('proxy_cache_lock on')
        expect(results).toContain('proxy_cache_bypass $http_authorization')
        expect(results).toContain('proxy_no_cache $http_authorization')
    })

    it('asks GitHub for the version once per 10 minutes for all workers', () => {
        const version = block('= /api/version')
        expect(version).toContain('proxy_cache_valid 200 10m')
        expect(version).toContain('proxy_cache_lock on')
        expect(nginx).toMatch(/keys_zone=microcache:[^;]*inactive=10m;/)
    })

    it('caches the unhashed app icons for a day', () => {
        expect(nginx).toMatch(
            /location ~ \^\/\(app-icon[^{]+\{[^}]+Cache-Control "public, max-age=86400"/,
        )
    })
})
