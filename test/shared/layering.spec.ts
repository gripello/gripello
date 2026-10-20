import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

describe('layering', () => {
    it('keeps domain types free of client utils', () => {
        const models = readFileSync('types/models.ts', 'utf8')
        expect(models).not.toMatch(/from '[^']*app\/utils/)
    })

    it('keeps every component in an area folder', () => {
        const rootComponents = readdirSync('app/components').filter((name) =>
            name.endsWith('.vue'),
        )
        expect(rootComponents).toEqual([])
    })

    it('resolves relative asset URLs in components', () => {
        const files = readdirSync('app/components', {
            recursive: true,
            encoding: 'utf8',
        }).filter((name) => name.endsWith('.vue'))
        const missing = files.flatMap((file) => {
            const source = readFileSync(join('app/components', file), 'utf8')
            return [...source.matchAll(/new URL\('(\.[^']+)'/g)]
                .map((match) =>
                    join('app/components', dirname(file), match[1]!),
                )
                .filter((target) => !existsSync(target))
        })
        expect(missing).toEqual([])
    })
})
