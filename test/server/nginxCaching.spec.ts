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

    it('asks GitHub for the version once per 10 minutes for all workers', () => {
        const version = block('= /api/version')
        expect(version).toContain('proxy_cache_valid 200 10m')
        expect(version).toContain('proxy_cache_lock on')
        expect(nginx).toMatch(/keys_zone=microcache:[^;]*inactive=10m;/)
    })

    it('lets the API hand file bodies to nginx only for requests that pass through it', () => {
        expect(block('/api/')).toContain('proxy_set_header X-Blob-Accel 1;')
    })

    it('serves public standings from a shared 1 s cache and passes personal ones through', () => {
        const standings = block('~ ^/api/competitions/[^/]+/standings$')
        expect(standings).toContain('proxy_pass http://api')
        expect(standings).toContain('proxy_cache_valid 200 1s')
        expect(standings).toContain('proxy_cache_lock on')
        expect(standings).toContain('proxy_cache_bypass $standings_personal')
        expect(standings).toContain('proxy_no_cache $standings_personal')
        expect(standings).toContain('limit_req zone=api')
        expect(nginx).toMatch(
            /map \$arg_view \$standings_public_view \{\s+default 0;\s+public 1;/,
        )
        expect(nginx).toContain(
            'map "$standings_public_view|$http_authorization$cookie_gripello_auth" $standings_personal {',
        )
        expect(nginx).toMatch(/default 1;\s+"~\^1\\\|" 0;\s+"0\|" 0;/)
    })

    it('serves robots.txt from disk and lets crawlers keep it for an hour', () => {
        expect(block('= /robots.txt')).toContain('try_files $uri @nuxt')
        expect(block('= /robots.txt')).toContain(
            'add_header Cache-Control "public, max-age=3600"',
        )
    })

    it('caches the unhashed app icons for a day', () => {
        expect(nginx).toMatch(
            /location ~ \^\/\(app-icon[^{]+\{[^}]+Cache-Control "public, max-age=86400"/,
        )
    })
})
