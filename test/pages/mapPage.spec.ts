import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/[gym]/map.vue', 'utf8')

describe('map page', () => {
    it('stays kept alive', () => {
        expect(source).toContain('definePageMeta({ keepalive: true })')
    })

    it('focuses a linked wall once it is loaded, not only on mount', () => {
        expect(source).toMatch(
            /watch\(\s*\(\) => selectedWall\.value\?\.id,[\s\S]{0,160}focusWall\(wallId\)/,
        )
    })
})
