import { execFileSync } from 'node:child_process'
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

    it('copies every repo file the Go tests read into the Go test stage', () => {
        const goTest = read('Dockerfile')
            .split(/^FROM /m)
            .find((stage) => stage.includes(' AS go-test'))!
        const files = execFileSync(
            'grep',
            [
                '-rhoE',
                '"(\\.\\./){3,}[^"]+"',
                'backend/internal',
                '--include=*_test.go',
            ],
            { encoding: 'utf8' },
        )
            .split('\n')
            .filter(Boolean)
            .map((path) => path.slice(1, -1).replace(/^(\.\.\/)+/, ''))
        expect(files).toContain('public/.well-known/assetlinks.json')
        for (const file of new Set(files))
            expect(
                goTest
                    .split('\n')
                    .filter((line) => line.startsWith('COPY '))
                    .some((line) => {
                        const source = line.split(' ')[1]!.replace('*.json', '')
                        return (
                            file.startsWith(source) ||
                            source.startsWith(`${file}/`)
                        )
                    }),
                file,
            ).toBe(true)
    })

    it('type-checks the app in CI', () => {
        expect(read('Dockerfile')).toMatch(
            /^FROM ui-deps AS typecheck\nCOPY \. \.\n# .+\nRUN --mount=type=cache,target=\/root\/\.npm mkdir \/out && \{ yarn typecheck > \/out\/typecheck\.txt 2>&1; echo \$\? > \/out\/exit-code; \}; cat \/out\/typecheck\.txt$/m,
        )
        expect(read('Dockerfile')).toContain('AS typecheck-results')
        expect(read('Jenkinsfile')).toContain(
            "reportCheck('Typecheck', 'test-results/typecheck-results/typecheck.txt') { runTestSuite('typecheck-results', false) }",
        )
    })

    it('ships only the node, pg_dump and vips binaries, without npm, perl or python', () => {
        const runtime = read('Dockerfile')
            .split(/^FROM /m)
            .at(-1)!
        expect(runtime).toMatch(/^debian:trixie-slim@sha256:/)
        expect(runtime).toContain(
            'COPY --from=ui-deps /usr/local/bin/node /usr/local/bin/node',
        )
        expect(runtime).toContain(
            'COPY --from=pg-client /out/bin/ /usr/local/bin/',
        )
        expect(runtime).not.toMatch(
            /apt-get install .*(postgresql-common|libvips-tools)/,
        )
        expect(runtime).toContain(
            'pg_dump --version && psql --version && vips --version && node --version',
        )
    })

    it('adds every SSL_DNS_NAMES entry to the self-signed certificate, skipping empty ones', () => {
        const sanLines = read('.docker/docker-entrypoint.sh').match(
            /^ *SAN="DNS:localhost,IP:127\.0\.0\.1"\n.*\n/m,
        )![0]
        const san = (names: string) =>
            execFileSync('bash', ['-c', `${sanLines}echo "$SAN"`], {
                env: { SSL_DNS_NAMES: names },
                encoding: 'utf8',
            }).trim()
        expect(san('')).toBe('DNS:localhost,IP:127.0.0.1')
        expect(san('a.test,,b.test,')).toBe(
            'DNS:localhost,IP:127.0.0.1,DNS:a.test,DNS:b.test',
        )
    })

    it('lets the e2e runner trust the self-signed certificate instead of skipping TLS checks', () => {
        const compose = read('e2e/docker-compose.e2e.yml')
        expect(compose).toContain('NODE_EXTRA_CA_CERTS: /ssl/cert.pem')
        expect(compose).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED')
    })

    it('drops the esbuild binary nitro traces for an unused capjs-core path', () => {
        expect(read('Dockerfile')).toContain(
            'rm -r .output/server/node_modules/esbuild .output/server/node_modules/@esbuild',
        )
    })

    it('keeps every pinned version where dependabot updates it', () => {
        const dockerfile = read('Dockerfile')
        expect(dockerfile).not.toMatch(/go (install|run) \S+@v/)
        expect(dockerfile).not.toMatch(/^COPY --from=\S+[:@]/m)
        expect(read('package.json')).not.toMatch(/go run \S+@v/)
        expect(read('.github/dependabot.yml')).toContain(
            'directory: "/backend/tools"',
        )
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
        expect(dockerfile).toContain(
            'go tool -modfile=tools/go.mod go-licenses report ./...',
        )
        expect(dockerfile).toContain(
            'node .docker/third-party-notices.mts && cat /tmp/third-party-notices-go.txt',
        )
        expect(
            dockerfile.indexOf('> .output/public/third-party-notices.txt'),
        ).toBeGreaterThan(dockerfile.indexOf('RUN yarn build'))
        expect(read('.docker/nginx.conf')).toContain(
            'location = /third-party-notices.txt {',
        )
    })

    it('gives the go tests the locales they check against', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/src\/i18n\/locales\/$/m,
        )
    })

    it('gives the go hook tests more than the default ten minutes', () => {
        expect(read('Dockerfile')).toContain(
            'go tool -modfile=tools/go.mod gotestsum --junitfile /out/junit.xml -- -timeout 30m -parallel 4 ./...',
        )
    })

    it('ships the locales the api renders mails and push texts from', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/app\/locales\/$/m,
        )
        expect(read('Dockerfile')).toContain('LOCALES_DIR=/app/locales')
    })

    it('ships pg_dump and psql matching the postgres server and a shared backup dir', () => {
        const server = read('docker-compose.yml').match(
            /image: postgres:(\d+)-alpine/,
        )?.[1]
        const dockerfile = read('Dockerfile')
        expect(dockerfile).toContain(`postgresql-client-${server}`)
        expect(dockerfile).toMatch(/\/bin\/psql \/out\/bin\//)
        expect(dockerfile).toContain('libreadline.so.8 /out/lib/')
        expect(dockerfile).toContain('BACKUP_DIR=/data/backups')
        expect(read('docker-compose.yml')).toContain('./backups:/data/backups')
    })

    it('gives postgres more than docker’s 64 MB /dev/shm for parallel queries', () => {
        for (const file of [
            'docker-compose.yml',
            'docker-compose.dev.yml',
            'e2e/docker-compose.e2e.yml',
        ]) {
            expect(read(file)).toMatch(
                /image: postgres:\d+-alpine\n\s+shm_size: 256mb/,
            )
        }
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
        expect(entrypoint).not.toContain('gripello migrate')
        expect(entrypoint).toContain('gripello serve --http=:8080 &')
        expect(read('.docker/healthcheck.mjs')).toContain(
            'http://127.0.0.1:8080/api/health',
        )
    })

    it('ends the health check without waiting for idle keep-alive sockets', () => {
        expect(read('.docker/healthcheck.mjs')).toMatch(/^process\.exit\(0\)$/m)
    })

    it('forwards docker stop to the api so a replica shuts down cleanly', () => {
        const entrypoint = read('.docker/docker-entrypoint.sh')
        expect(entrypoint.indexOf('trap stop_all TERM INT')).toBeLessThan(
            entrypoint.indexOf('gripello serve'),
        )
        expect(entrypoint).not.toMatch(/^exec /m)
        expect(entrypoint).toMatch(/^trap stop_all TERM INT$/m)
        expect(entrypoint).toContain(
            'kill -TERM $API_PID -$UI_PID 2>/dev/null || true',
        )
        expect(entrypoint).toContain(
            'kill -QUIT $NGINX_PID 2>/dev/null || true',
        )
        expect(entrypoint.trimEnd()).toMatch(/\nwait$/)
    })

    it('stops the nuxt cluster workers, which their primary never signals', () => {
        const entrypoint = read('.docker/docker-entrypoint.sh')
        expect(entrypoint).toContain('setsid node ui/server/index.mjs &')
        expect(entrypoint).toContain('-$UI_PID')
    })

    it('starts nginx only once the api and nuxt accept connections', () => {
        const entrypoint = read('.docker/docker-entrypoint.sh')
        const waitLoop = entrypoint.indexOf(
            'for port in 8080 3000; do\n    until (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; do',
        )
        expect(waitLoop).toBeGreaterThan(entrypoint.indexOf('UI_PID=$!'))
        expect(waitLoop).toBeLessThan(entrypoint.indexOf('nginx -e stderr'))
        expect(entrypoint).toContain(
            'kill -0 $API_PID $UI_PID 2>/dev/null || break 2',
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
        expect(nginx).not.toContain('location /api/v1/')
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
