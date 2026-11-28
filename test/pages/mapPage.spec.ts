import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/map.vue'),
    'utf8',
)

describe('map page search', () => {
    it('matches the loaded location routes locally instead of asking the server per keystroke', () => {
        expect(source).toMatch(
            /routes\.value\s+\.filter\(\s+\(item\) =>\s+!hasRouteQuery\.value \|\|\s+routeMatchesQuery\(item, routeQuery\.value\)/,
        )
        expect(source.match(/listRoutes\(/g)).toHaveLength(1)
        expect(source).toContain(
            'listRoutes(gymId.value, { location: locationId.value })',
        )
    })

    it('shows the load error only for the map data itself', () => {
        expect(source).toMatch(
            /const loadFailed = computed\(\s+\(\) =>\s+!!routesError\.value \|\|\s+!!wallsError\.value \|\|\s+!!locationsError\.value,?\s+\)/,
        )
        expect(source).toMatch(
            /v-if="loadFailed"[\s\S]+?<LayoutLoadError[^>]+@retry="retryLoad"/,
        )
    })
})
