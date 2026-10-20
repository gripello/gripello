import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/composables/useInventorySession.ts',
    ),
    'utf8',
)

describe('inventory page', () => {
    it('keeps start enabled while live changes reload the routes', () => {
        const loadRoutes = source.slice(source.indexOf('const loadRoutes'))
        expect(loadRoutes).toMatch(
            /^const loadRoutes = async \(\) => \{\s+loadingRoutes\.value = allRoutes\.value\.length === 0\n/,
        )
    })
})
