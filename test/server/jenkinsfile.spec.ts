import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const jenkinsfile = readFileSync('Jenkinsfile', 'utf8')
const checkCall = (name: string) =>
    jenkinsfile.slice(
        jenkinsfile.indexOf(`ci.check('${name}'`),
        jenkinsfile.indexOf(`ci.check('${name}'`) + 120,
    )

describe('release builds', () => {
    it('skips tests only for a version bump right after a green build of its parent', () => {
        expect(jenkinsfile).toContain(
            "def onlyVersionBump = sh(script: 'git diff --name-only HEAD~1 || true', returnStdout: true).trim() == 'package.json'",
        )
        expect(jenkinsfile).toContain(
            "def parentPassed = currentBuild.previousBuild?.result == 'SUCCESS' && ci.builtCommits() == [head]",
        )
        expect(jenkinsfile).toContain(
            "env.SKIP_TESTS = (env.IS_RELEASE == 'true' && onlyVersionBump && parentPassed).toString()",
        )
    })

    it.each(['Vitest', 'Go Tests', 'Build Image', 'E2E Tests'])(
        'reports %s as skipped instead of hiding it',
        (name) =>
            expect(checkCall(name)).toMatch(
                /when: (runTests|env\.SKIP_TESTS != 'true')/,
            ),
    )

    it.each(['Typecheck', 'API Types', 'Android', 'Push Image', 'Play Store'])(
        'always runs %s',
        (name) => {
            expect(jenkinsfile).toContain(`ci.check('${name}'`)
            expect(checkCall(name)).not.toContain('when:')
        },
    )
})

describe('pod agents', () => {
    const pod = readFileSync('.jenkins/e2e-pod.yaml', 'utf8')
    const compose = readFileSync('e2e/docker-compose.e2e.yml', 'utf8')
    const images = (source: string) =>
        [...source.matchAll(/^\s*image: (\S+)$/gm)].map(([, image]) => image)

    it('needs no docker daemon', () => {
        expect(jenkinsfile).toContain("agent { label 'k8s-m' }")
        expect(jenkinsfile).toContain('ci.buildx {')
        expect(jenkinsfile).not.toMatch(
            /docker compose|--load\b|docker (image|volume|run)\b/,
        )
    })

    it('runs e2e against the pushed image by digest and ships that image', () => {
        expect(jenkinsfile).toContain(
            "readFile('.jenkins/e2e-pod.yaml').replace('APP_IMAGE', env.E2E_IMAGE_REF)",
        )
        expect(jenkinsfile).toContain(
            'docker buildx imagetools create ${env.RELEASE_TAGS} ${env.E2E_IMAGE_REF}',
        )
    })

    it('takes every e2e service image from the compose file dependabot pins', () => {
        const services = images(pod)
            .filter((image) => image.startsWith('compose:'))
            .map((image) => image.slice('compose:'.length))
        expect(images(pod).sort()).toEqual(
            [
                'APP_IMAGE',
                ...services.map((service) => `compose:${service}`),
            ].sort(),
        )
        expect(jenkinsfile).toContain(
            `for (def service : [${services.map((service) => `'${service}'`).join(', ')}])`,
        )
        for (const service of services) {
            const image = execFileSync('.jenkins/compose-image.sh', [service], {
                encoding: 'utf8',
            }).trim()
            expect(compose).toContain(`image: ${image}`)
        }
        expect(compose).toContain(
            `image: ${execFileSync('.jenkins/compose-image.sh', ['e2e'], { encoding: 'utf8' }).trim()}`,
        )
        expect(compose).toMatch(
            /image: mcr\.microsoft\.com\/playwright:\S+@sha256:/,
        )
        const buildOnly = join(
            mkdtempSync(join(tmpdir(), 'compose-')),
            'compose.yml',
        )
        writeFileSync(
            buildOnly,
            'services:\n    app:\n        build: .\n    db:\n        image: postgres:18\n',
        )
        expect(() =>
            execFileSync('.jenkins/compose-image.sh', ['app', buildOnly], {
                stdio: 'pipe',
            }),
        ).toThrow()
        expect(() =>
            execFileSync('.jenkins/compose-image.sh', ['missing'], {
                stdio: 'pipe',
            }),
        ).toThrow()
    })

    it('gives the app the same environment as the compose file', () => {
        const app = compose.slice(
            compose.indexOf('environment:'),
            compose.indexOf('depends_on:'),
        )
        for (const [, name, value] of app.matchAll(
            /^\s+(\w+): '?([^'\n]*)'?$/gm,
        )) {
            expect(pod).toMatch(
                new RegExp(
                    `name: ${name}, value: '?${value.replace(/[.?]/g, '\\$&')}'?`,
                ),
            )
        }
    })

    it('sets HOME and PATH in the e2e step, since the container step passes the agent ones', () => {
        expect(jenkinsfile).toContain(
            'export HOME=/tmp/home NPM_CONFIG_PREFIX=/tmp/npm PATH="/tmp/npm/bin:$PATH"',
        )
        expect(pod).not.toMatch(/name: (HOME|PATH|NPM_CONFIG_PREFIX),/)
    })

    it('takes the e2e image digest from the build metadata', () => {
        expect(jenkinsfile).toContain(
            '--metadata-file \\"\\$WORKSPACE_TMP/app-image.json\\"',
        )
        expect(jenkinsfile).toContain('"containerimage.digest"')
    })

    it('retries a lost e2e pod', () => {
        expect(jenkinsfile).toContain(
            'retry(count: 2, conditions: [kubernetesAgent(), nonresumable()])',
        )
    })
})

it('reports flaky e2e tests as a neutral check, not an unstable build', () => {
    expect(jenkinsfile).toContain("conclusion: 'NEUTRAL'")
    expect(jenkinsfile).not.toMatch(/\bunstable\(/)
})

it('rolls releases out to the public Play Store listing', () => {
    expect(jenkinsfile).toContain("PLAY_TRACK = 'production'")
    expect(jenkinsfile).toContain("PLAY_STATUS = 'completed'")
})

describe('e2e container', () => {
    it('installs one pinned corepack before enabling it, since Node 25+ images ship without it', () => {
        const sources = [
            'Jenkinsfile',
            'e2e/docker-compose.e2e.yml',
            'Dockerfile',
        ].map((file) => readFileSync(file, 'utf8'))
        const versions = new Set<string>()
        for (const source of sources) {
            expect(source).toContain('corepack enable')
            expect(source).not.toMatch(
                /(?<!npm install -g corepack@\d+\.\d+\.\d+ --force && )corepack enable/,
            )
            for (const [, version] of source.matchAll(
                /corepack@(\d+\.\d+\.\d+)/g,
            ))
                versions.add(version)
        }
        expect(versions.size).toBe(1)
    })
})
