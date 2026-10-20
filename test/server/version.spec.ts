import { describe, expect, it } from 'vitest'
import { compareSemver } from '#shared/utils/version'
import { decideUpdate } from '../../server/utils/version'
import { parseAppVersion, versionLabel } from '#shared/utils/version'

describe('parseAppVersion', () => {
    it('parses a clean release tag', () => {
        expect(parseAppVersion('1.10.3')).toEqual({
            raw: '1.10.3',
            base: '1.10.3',
            ahead: 0,
            sha: null,
        })
    })

    it('strips a leading v', () => {
        expect(parseAppVersion('v1.10.3').base).toBe('1.10.3')
    })

    it('parses the git-describe shape CI actually produces', () => {
        expect(parseAppVersion('1.10.3-7-gabc1234')).toEqual({
            raw: '1.10.3-7-gabc1234',
            base: '1.10.3',
            ahead: 7,
            sha: 'abc1234',
        })
    })

    it('parses a bare sha, as emitted when no tag is reachable', () => {
        expect(parseAppVersion('4f6a192')).toEqual({
            raw: '4f6a192',
            base: null,
            ahead: 0,
            sha: '4f6a192',
        })
    })

    it('yields an empty parse for unrecognised input', () => {
        for (const input of ['dev', '', undefined, null, 'not-a-version']) {
            const parsed = parseAppVersion(input)
            expect(parsed.base).toBeNull()
            expect(parsed.sha).toBeNull()
        }
    })
})

describe('compareSemver', () => {
    it('orders releases', () => {
        expect(compareSemver('1.10.0', '1.9.0')).toBe(1)
        expect(compareSemver('1.9.0', '1.10.0')).toBe(-1)
        expect(compareSemver('v1.9.0', '1.9.0')).toBe(0)
    })

    it('compares numerically, not lexically', () => {
        expect(compareSemver('1.10.3', '1.9.9')).toBe(1)
        expect(compareSemver('2.0.0', '1.99.99')).toBe(1)
    })

    it('returns null instead of coercing unparseable input to zero', () => {
        expect(compareSemver('2.0.0-rc1', '2.0.0')).toBeNull()
        expect(compareSemver('1.10.3-7-gabc1234', '1.10.3')).toBeNull()
        expect(compareSemver(undefined, '1.0.0')).toBeNull()
    })
})

describe('decideUpdate', () => {
    const release = parseAppVersion('1.9.0')
    const rolling = parseAppVersion('1.9.0-7-gabc1234')
    const bareSha = parseAppVersion('4f6a192')

    it('reports a release when a newer tag exists', () => {
        expect(decideUpdate(release, 'v1.10.0', 0)).toEqual({
            mode: 'release',
            updateAvailable: true,
        })
    })

    it('stays quiet when the installed tag is the latest', () => {
        expect(decideUpdate(release, 'v1.9.0', 0)).toEqual({
            mode: 'none',
            updateAvailable: false,
        })
    })

    it('reports commits for a rolling build ahead of its own tag', () => {
        expect(decideUpdate(rolling, 'v1.9.0', 7)).toEqual({
            mode: 'commit',
            updateAvailable: true,
        })
    })

    it('prefers a newer release over commits when both apply', () => {
        expect(decideUpdate(rolling, 'v1.10.0', 7)).toEqual({
            mode: 'release',
            updateAvailable: true,
        })
    })

    it('uses the authoritative ahead count, not the git-describe hint', () => {
        expect(decideUpdate(rolling, 'v1.9.0', 0)).toEqual({
            mode: 'none',
            updateAvailable: false,
        })
    })

    it('handles a bare sha with no comparable tag', () => {
        expect(decideUpdate(bareSha, 'v1.10.0', 3)).toEqual({
            mode: 'commit',
            updateAvailable: true,
        })
    })

    it('stays quiet when the version is unrecognisable', () => {
        expect(decideUpdate(parseAppVersion('dev'), 'v1.10.0', 5)).toEqual({
            mode: 'none',
            updateAvailable: false,
        })
    })
})

describe('versionLabel', () => {
    it('shows the plain version for a release build', () => {
        expect(versionLabel('2.0.0')).toBe('2.0.0')
    })

    it('appends the commit for a rolling build past the tag', () => {
        expect(versionLabel('2.0.0-3-gabc1234def')).toBe('2.0.0-abc1234')
    })

    it('marks dev builds', () => {
        expect(versionLabel('2.0.0', true)).toBe('2.0.0-dev')
        expect(versionLabel('dev', true)).toBe('dev')
    })
})
