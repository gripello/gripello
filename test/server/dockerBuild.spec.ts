import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BETA_VIDEO_MAX_BYTES } from '#shared/utils/betaVideos'

const read = (file: string) => readFileSync(file, 'utf8')

describe('docker ui build', () => {
    const localDirs = [
        ...read('nuxt.config.ts').matchAll(/'\.\/([\w-]+)\/[\w.-]+'/g),
    ].map((match) => match[1]!)

    it('ships every local directory nuxt.config.ts loads', () => {
        expect(localDirs).toContain('postcss')
        for (const dir of new Set(localDirs)) {
            expect(read('Dockerfile')).toMatch(
                new RegExp(`^COPY ${dir} \\./${dir}$`, 'm'),
            )
            expect(read('.dockerignore')).toMatch(new RegExp(`^!${dir}$`, 'm'))
        }
    })

    it('renders pages in a capped pool of worker processes', () => {
        expect(read('Dockerfile')).toContain('NITRO_PRESET=node-cluster')
        expect(read('.docker/docker-entrypoint.sh')).toContain(
            'export NITRO_CLUSTER_WORKERS="${NITRO_CLUSTER_WORKERS:-$(( WORKERS > 8 ? 8 : WORKERS ))}"',
        )
    })

    it('lets nginx pass the largest beta video upload', () => {
        const [, megabytes] = read('.docker/nginx.conf').match(
            /client_max_body_size (\d+)m;/,
        )!
        expect(Number(megabytes) * 1024 * 1024).toBeGreaterThan(
            BETA_VIDEO_MAX_BYTES,
        )
    })

    it('ships the license and labels the image with it', () => {
        expect(read('package.json')).toContain('"license": "BUSL-1.1"')
        expect(read('LICENSE')).toMatch(/^Business Source License 1\.1$/m)
        expect(read('Dockerfile')).toMatch(/^COPY LICENSE \/app\/LICENSE$/m)
        expect(read('Dockerfile')).toContain(
            'org.opencontainers.image.licenses="BUSL-1.1"',
        )
        expect(read('.dockerignore')).toMatch(/^!LICENSE$/m)
    })

    it('publishes and documents the image on ghcr.io only', () => {
        expect(read('Jenkinsfile')).toContain(
            'IMAGE_NAME = "ghcr.io/gripello/gripello"',
        )
        expect(read('Jenkinsfile')).toContain('docker login ghcr.io')
        expect(read('docker-compose.yml')).toContain(
            'image: ghcr.io/gripello/gripello:rolling',
        )
        expect(read('README.md')).toContain(
            'image: ghcr.io/gripello/gripello:latest',
        )
        for (const file of ['Jenkinsfile', 'docker-compose.yml', 'README.md']) {
            expect(read(file)).not.toContain('verti-grade')
        }
    })

    it('serves third-party notices for npm and go dependencies', () => {
        const dockerfile = read('Dockerfile')
        expect(dockerfile).toContain('go-licenses/v2@v2.0.1 report ./...')
        expect(dockerfile).toContain(
            'node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt',
        )
        expect(
            dockerfile.indexOf('public/third-party-notices.txt'),
        ).toBeLessThan(dockerfile.indexOf('RUN yarn build'))
    })

    it('gives the go tests the locales they check against', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/src\/i18n\/locales\/$/m,
        )
    })

    it('gives the go hook tests more than the default ten minutes', () => {
        expect(read('Dockerfile')).toContain(
            'gotestsum@v1.13.0 --junitfile /out/junit.xml -- -timeout 30m ./...',
        )
    })

    it('ships the locales the api renders mails and push texts from', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/app\/locales\/$/m,
        )
        expect(read('Dockerfile')).toContain('LOCALES_DIR=/app/locales')
    })

    it('builds and starts the go api instead of pocketbase', () => {
        const dockerfile = read('Dockerfile')
        expect(dockerfile).toContain('-o /out/gripello ./cmd/gripello')
        expect(dockerfile).toContain(
            '-X gripello/internal/platform/config.Version=',
        )
        expect(dockerfile).not.toMatch(/pocketbase/i)
        for (const dir of ['cmd', 'internal']) {
            expect(dockerfile).toContain(`COPY backend/${dir} ./${dir}`)
            expect(read('.dockerignore')).toMatch(
                new RegExp(`^!backend/${dir}$`, 'm'),
            )
        }
        const entrypoint = read('.docker/docker-entrypoint.sh')
        expect(entrypoint).toContain('gripello migrate')
        expect(entrypoint).toContain('gripello serve --http=:8080 &')
        expect(read('.docker/healthcheck.mjs')).toContain(
            'http://127.0.0.1:8080/api/health',
        )
    })

    it('rate-limits the api in nginx and keeps the realtime stream open', () => {
        const nginx = read('.docker/nginx.conf')
        expect(nginx).toContain('limit_req_status 429;')
        expect(nginx).toContain('include /etc/nginx/rate-limit.conf;')
        expect(nginx).toMatch(
            /location = \/api\/realtime \{[^}]*proxy_buffering off;[^}]*proxy_read_timeout 35m;/,
        )
        expect(nginx).toContain(
            'limit_conn_zone $rl_key zone=realtime_conn:10m;',
        )
        expect(nginx).toMatch(
            /location = \/api\/realtime \{[^}]*limit_conn realtime_conn \d+;/,
        )
        expect(nginx).toMatch(
            /location \/api\/v1\/ \{\s*rewrite \^\/api\/v1\/\(\.\*\)\$ \/api\/\$1 last;\s*\}/,
        )
        expect(nginx).not.toContain('location /_/')
        const zones = [
            ...nginx.matchAll(/limit_req_zone \S+ +zone=(\w+):/g),
        ].map((match) => match[1])
        const used = [...nginx.matchAll(/limit_req zone=(\w+) /g)].map(
            (match) => match[1],
        )
        expect(new Set(used)).toEqual(new Set(zones))
    })
})
