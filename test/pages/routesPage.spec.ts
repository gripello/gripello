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

describe('routes page load error', () => {
    it('keeps one failure flag that a later successful load clears', () => {
        expect(source).not.toMatch(/routesError\.value \|\|/)
        expect(source).toMatch(
            /watch\(\s+routesError,\s+\(error\) => \{\s+loadFailed\.value = !!error/,
        )
        const loadRoutes = source.slice(
            source.indexOf('async function loadRoutes'),
        )
        expect(loadRoutes).toMatch(
            /totalItems: res\.totalItems,\s+\}\s+loadFailed\.value = false/,
        )
    })
})

describe('routes page table', () => {
    it('keeps the row actions icon-only so the table fits', () => {
        expect(source).toContain(
            '<RouteDetails :route_id="row.original.id" compact />',
        )
    })
})

describe('routes page comment column', () => {
    it('stays while paging and while sorted by comment', () => {
        expect(source).toMatch(
            /tableOptions\.page === 1 \? any : commentsSeen\.value \|\| any/,
        )
        expect(source).toMatch(
            /commentsSeen\.value \|\| tableOptions\.sortBy\[0\]\?\.key === 'comment'/,
        )
        expect(source).toContain('...(showComments.value')
    })
})

describe('manage routes page', () => {
    it('shows the marker legend only in the phone filter sheet', () => {
        const manage = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/pages/[gym]/manage/routes.vue',
            ),
            'utf8',
        )
        expect(manage).toMatch(
            /text-muted sm:hidden"\s+data-testid="routes-marker-legend"/,
        )
    })

    it('keeps loaded rows when a background reload fails', () => {
        const manage = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/pages/[gym]/manage/routes.vue',
            ),
            'utf8',
        )
        expect(manage).toContain(
            'if (!background || routes.value.length === 0) listFailed.value = true',
        )
        expect(manage).toMatch(
            /queueReload = coalesce\(\s*\(\) => reloadRoutes\(\{ background: true \}\)/,
        )
        expect(manage).toContain('{ resync: queueReload }')
    })
})
