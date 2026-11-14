import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(
    path.resolve(import.meta.dirname, '../../app/pages/[gym]/feed.vue'),
    'utf8',
)

describe('feed beta delete', () => {
    it('closes the confirmation only after the delete succeeded', () => {
        const confirmDelete = source.slice(
            source.indexOf('async function confirmDelete'),
        )
        expect(confirmDelete).toMatch(
            /const deleted = await runDelete\([\s\S]+?return true[\s\S]+?\)\s+if \(!deleted\) return\s+deleteTarget\.value = null/,
        )
    })
})

describe('feed empty states', () => {
    it('frames every empty section the same way', () => {
        expect(source).not.toContain(':card="false"')
        expect(source).toContain('data-testid="feed-routes-empty"')
    })
})
