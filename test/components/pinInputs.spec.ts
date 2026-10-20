import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('UPinInput bindings', () => {
    it('binds a stable value, never a call that builds a new array per render', () => {
        const files = readdirSync('app', { recursive: true, encoding: 'utf8' })
            .filter((name) => name.endsWith('.vue'))
            .map((name) => join('app', name))
        const offenders = files.filter((file) =>
            [
                ...readFileSync(file, 'utf8').matchAll(
                    /<UPinInput[^>]*?:model-value="([^"]*)"/gs,
                ),
            ].some((match) => match[1]!.includes('(')),
        )
        expect(offenders).toEqual([])
    })
})
