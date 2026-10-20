import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('cookie names', () => {
    it('come from the shared constants, never string literals', () => {
        const literal =
            /\b(?:getCookie|setCookie|deleteCookie)\(\s*\w+,\s*['"`]|\buseCookie(?:<[^>]*>)?\(\s*['"`]|storageKey:\s*['"`]/
        const offenders = [
            ...globSync('{app,server,shared}/**/*.{ts,vue}'),
            'nuxt.config.ts',
        ].filter((file) => literal.test(readFileSync(file, 'utf8')))
        expect(offenders).toEqual([])
    })
})
