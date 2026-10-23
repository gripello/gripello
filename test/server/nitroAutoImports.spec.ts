import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps nitro auto-imports on for @nuxtjs/i18n and server/', () => {
    expect(readFileSync('nuxt.config.ts', 'utf8')).toMatch(
        /^\s*nitroAutoImports: true,$/m,
    )
})
