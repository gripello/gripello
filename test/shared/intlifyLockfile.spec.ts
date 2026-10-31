import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const lockfile = readFileSync('yarn.lock', 'utf8')

// @nuxtjs/i18n aliases each of these to one copy, so mixed 11.x versions break the build with MISSING_EXPORT
it('resolves vue-i18n and @intlify/* 11.x to a single version', () => {
    const versions = new Set(
        [
            ...lockfile.matchAll(
                /^"?(?:vue-i18n|@intlify\/(?:shared|core|core-base|message-compiler))@npm:.*\n {2}version: (11\.\S+)/gm,
            ),
        ].map((match) => match[1]),
    )
    expect([...versions]).toHaveLength(1)
})
