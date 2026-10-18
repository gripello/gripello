import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const jenkinsfile = readFileSync('Jenkinsfile', 'utf8')

describe('docker build cache', () => {
    it('reads the cache on every image and test build', () => {
        const builds = jenkinsfile
            .split('\n')
            .filter((line) => line.includes('docker buildx build'))
        expect(builds.length).toBeGreaterThan(0)
        for (const build of builds) expect(build).toContain('${buildCache(')
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
