import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/routes.vue'),
    'utf8',
)

describe('routes page', () => {
    it('keeps live patches that land while a search or page loads', () => {
        const loadRoutes = source.slice(
            source.indexOf('async function loadRoutes'),
        )
        expect(loadRoutes).toMatch(
            /await unlessQueryChanged\(\s+loadedQuery,[\s\S]+?\(\) => routePage\.value,\s+\)\s+if \(loadedQuery\(\) !== before\) return/,
        )
    })
})
