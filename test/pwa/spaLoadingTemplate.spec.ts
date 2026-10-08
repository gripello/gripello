import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
    readFileSync(resolve(import.meta.dirname, path), 'utf8')

describe('spa loading template', () => {
    const template = read('../../app/spa-loading-template.html')

    it('paints the app background of both themes', () => {
        const backgrounds = [
            ...read('../../app/assets/css/main.css').matchAll(
                /--app-bg: (#[0-9a-f]{6})/g,
            ),
        ].map((match) => match[1]!)
        expect(backgrounds).toHaveLength(2)
        for (const color of backgrounds) expect(template).toContain(color)
    })

    it('follows the stored theme choice', () => {
        expect(template).toContain('theme-mode=')
    })
})
