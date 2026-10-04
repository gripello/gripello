import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { thirdPartyNotices } from '../../.docker/third-party-notices.mts'

let root: string

function addPackage(
    dir: string,
    pkg: object,
    files: Record<string, string> = {},
) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
    for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text)
    }
}

describe('thirdPartyNotices', () => {
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'notices-'))
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    it('lists scoped and nested packages with their license and notice files', () => {
        addPackage(
            join(root, 'b-lib'),
            { name: 'b-lib', version: '1.0.0', license: 'MIT' },
            { LICENSE: 'MIT text' },
        )
        addPackage(
            join(root, '@scope/a-lib'),
            {
                name: '@scope/a-lib',
                version: '2.0.0',
                license: { type: 'Apache-2.0' },
            },
            { 'LICENSE.txt': 'Apache text', NOTICE: 'Notice text' },
        )
        addPackage(join(root, 'b-lib/node_modules/c-lib'), {
            name: 'c-lib',
            version: '0.1.0',
        })

        const notices = thirdPartyNotices(root)

        expect(notices).toContain(
            '@scope/a-lib@2.0.0 (Apache-2.0)\n\nApache text\n\nNotice text',
        )
        expect(notices).toContain('b-lib@1.0.0 (MIT)\n\nMIT text')
        expect(notices).toContain(
            'c-lib@0.1.0 (UNKNOWN)\n\nNo license file shipped with the package.',
        )
        expect(notices.indexOf('@scope/a-lib')).toBeLessThan(
            notices.indexOf('b-lib'),
        )
    })

    it('lists a package once and skips license directories', () => {
        addPackage(join(root, 'dup'), {
            name: 'dup',
            version: '1.0.0',
            license: 'ISC',
        })
        mkdirSync(join(root, 'dup/license'))
        addPackage(join(root, 'other/node_modules/dup'), {
            name: 'dup',
            version: '1.0.0',
            license: 'ISC',
        })

        const notices = thirdPartyNotices(root)

        expect(notices.match(/^dup@1\.0\.0/gm)).toHaveLength(1)
        expect(notices).toContain(
            'dup@1.0.0 (ISC)\n\nNo license file shipped with the package.',
        )
    })
})
