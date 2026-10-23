import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(
        import.meta.dirname,
        '../../app/pages/[gym]/manage/routes.vue',
    ),
    'utf8',
)

describe('manage routes page loads', () => {
    const loadRoutes = source.slice(
        source.indexOf('const loadRoutes = async'),
        source.indexOf('const onRouteSaved'),
    )

    it('drops responses, errors and loading resets of superseded loads', () => {
        expect(source).toContain(
            'const startRouteLoad = latestRequestTracker()',
        )
        expect(loadRoutes).toContain('const isLatest = startRouteLoad()')
        expect(loadRoutes).toMatch(
            /total: true,\s+\}\)\s+if \(!isLatest\(\)\) return\s+routes\.value =/,
        )
        expect(loadRoutes).toContain(
            'if (!isLatest() || isAbortError(error)) return',
        )
        expect(loadRoutes).toMatch(
            /finally \{\s+if \(isLatest\(\)\) loading\.value = false/,
        )
    })
})
