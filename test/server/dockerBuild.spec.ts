import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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

    it('gives the go tests the locales they check against', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/i18n\/locales\/$/m,
        )
    })

    it('ships the locales pocketbase renders push texts from', () => {
        expect(read('Dockerfile')).toMatch(
            /^COPY i18n\/locales\/\*\.json \/pb\/locales\/$/m,
        )
        expect(read('Dockerfile')).toContain('PB_LOCALES_DIR=/pb/locales')
    })
})
