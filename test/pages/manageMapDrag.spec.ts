import { readFileSync } from 'node:fs'

describe('placement page route drag', () => {
    it('drags list rows through useLongPressDrag, which claims touchmove in the capture phase', () => {
        const page = readFileSync('app/pages/[gym]/manage/map.vue', 'utf8')
        const drag = readFileSync('app/composables/useLongPressDrag.ts', 'utf8')
        expect(page).toContain('@pointerdown="drag.startPointer($event, item)"')
        expect(drag).toMatch(
            /addEventListener\('touchmove', onTouchMove, \{\s*passive: false,\s*capture: true,/,
        )
    })

    it('strips a wall without its permanent routes and counts only those', () => {
        const page = readFileSync('app/pages/[gym]/manage/map.vue', 'utf8')
        expect(page).toContain('const ids = removableRouteIds(items)')
        expect(page).toContain('n: resettableRouteIds.length')
        expect(page).not.toContain('savedWallRouteIds.value.length')
    })
})
