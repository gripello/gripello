import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(import.meta.dirname, '../../app')
// Trailing buttons inside an input: a 44px hit area would cover the field.
const IN_FIELD = new Set([
    'components/user/PasswordField.vue',
    'components/filter/Bar.vue',
    'pages/[gym]/map.vue',
    'pages/[gym]/manage/inventory.vue',
    'pages/[gym]/manage/map.vue',
])

describe('icon-only buttons', () => {
    it('get the 44px icon-btn hit area', () => {
        const missing = readdirSync(appDir, {
            recursive: true,
            encoding: 'utf8',
        })
            .filter((file) => file.endsWith('.vue') && !IN_FIELD.has(file))
            .flatMap((file) => {
                const source = readFileSync(path.join(appDir, file), 'utf8')
                return [
                    ...source.matchAll(/<UButton\b((?:[^>"]|"[^"]*")*?)\/>/g),
                ]
                    .filter(
                        ([, attrs]) =>
                            /\s:?icon=/.test(attrs!) &&
                            attrs!.includes('aria-label') &&
                            !/\s:?label=/.test(attrs!) &&
                            !attrs!.includes('icon-btn'),
                    )
                    .map(
                        (match) =>
                            `${file}:${source.slice(0, match.index).split('\n').length}`,
                    )
            })
        expect(missing).toEqual([])
    })
})
