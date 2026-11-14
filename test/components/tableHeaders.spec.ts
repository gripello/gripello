import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const appDir = path.resolve(import.meta.dirname, '../../app')
const sources = readdirSync(appDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(vue|ts)$/.test(file))
    .map((file) => ({
        file,
        source: readFileSync(path.join(appDir, file), 'utf8'),
    }))

describe('table columns', () => {
    // UTable renders an empty-string header as a text node the server leaves out, so hydration mismatches.
    it('leave out the header of a label-less column instead of passing an empty string', () => {
        const offenders = sources
            .filter(({ source }) => /\bheader:\s*(''|"")/.test(source))
            .map(({ file }) => file)
        expect(offenders).toEqual([])
    })
})
