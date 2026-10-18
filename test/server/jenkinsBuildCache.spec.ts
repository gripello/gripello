import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const jenkinsfile = readFileSync('Jenkinsfile', 'utf8')

describe('docker build cache', () => {
    const builds = jenkinsfile
        .split('\n')
        .filter((line) => line.includes('docker buildx build'))
    const isPlayRelease = (build: string) =>
        build.includes('--target android-release-results')

    it('reads the cache on every image and test build', () => {
        const cached = builds.filter((build) => !isPlayRelease(build))
        expect(cached.length).toBeGreaterThan(0)
        for (const build of cached) expect(build).toContain('${buildCache(')
    })

    it('keeps the signed release bundle out of the registry cache', () => {
        const release = builds.filter(isPlayRelease)
        expect(release).toHaveLength(1)
        expect(release[0]).not.toContain('buildCache(')
    })

    it('keeps one tag per target in a separate package, written only by main', () => {
        expect(jenkinsfile).toContain(
            'CACHE_IMAGE = "ghcr.io/gripello/gripello-cache"',
        )
        expect(jenkinsfile).toContain('def ref = "${env.CACHE_IMAGE}:${name}"')
        expect(jenkinsfile).toMatch(
            /if \(env\.BRANCH_NAME == 'main'\) \{\s*args \+= " --cache-to type=registry,ref=\$\{ref\},mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true"/,
        )
    })
})
