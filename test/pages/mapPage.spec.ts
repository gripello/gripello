import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/map.vue'),
    'utf8',
)

describe('map page server-side filter', () => {
    it('dims nothing until the matching routes have loaded', () => {
        expect(source).toMatch(
            /const serverIds =\s+hasServerFilter\.value && serverMatches\.value\s+\? new Set\(serverMatches\.value\.map/,
        )
        expect(source).toContain(
            'if (!serverIds && !hasSentFilter && !colorFilter.value) return null',
        )
        expect(source).not.toContain('serverMatches.value ?? []')
    })

    it('shows the load error with a retry when the matching fetch fails', () => {
        expect(source).toMatch(/error: matchesError,\s+refresh: refreshMatches/)
        expect(source).toMatch(
            /const loadFailed = computed\([\s\S]+?!!matchesError\.value/,
        )
        expect(source).toMatch(
            /async function retryLoad\(\) \{[\s\S]+?refreshMatches\(\)/,
        )
        expect(source).toMatch(
            /v-if="loadFailed"[\s\S]+?<LayoutLoadError[^>]+@retry="retryLoad"/,
        )
    })
})
