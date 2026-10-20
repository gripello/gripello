import { readFileSync } from 'node:fs'

const source = readFileSync('app/pages/[gym]/manage/map.vue', 'utf8')

describe('placement map on phones', () => {
    it('opens with the map and the sheet peeking', () => {
        expect(source).toContain("const sheetSnap = ref<SheetSnap>('peek')")
        expect(source).toMatch(
            /data-testid="placement-open-list"\s+@click="sheetSnap = 'half'"/,
        )
    })

    it('works wall by wall with chips instead of the filter row', () => {
        expect(source).toMatch(
            /v-if="!mdAndUp"[\s\S]{0,200}data-testid="placement-wall-chips"/,
        )
        expect(source).toContain('@click="selectWall(wall.id, false)"')
        expect(source).toMatch(/<MapFilterChips\s+v-else/)
    })

    it('keeps the heat legend off the map', () => {
        expect(source).toContain('v-if="wallTints.size && mdAndUp"')
        expect(source).toContain('v-if="wallTints.size && !mdAndUp"')
    })
})
