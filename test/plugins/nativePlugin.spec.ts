import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('native plugin', () => {
    it('calls composables before its first await, while the app context exists', () => {
        const source = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/plugins/native.client.ts',
            ),
            'utf8',
        )
        const afterFirstAwait = source.slice(source.indexOf('await '))
        expect(afterFirstAwait).not.toMatch(/\buse[A-Z]\w*\(/)
    })
})
