import {
    TAG_GEOMETRY,
    TAG_TEMPLATES,
    tagSlot,
} from '#shared/utils/tagTemplates'
import { TAG_HEIGHT, TAG_WIDTH } from '../../server/utils/routeTag'

describe('tag templates', () => {
    it.each(TAG_TEMPLATES)(
        '%s fits every tag on the page without overlap',
        (template) => {
            const { page, cols, rows, scale } = TAG_GEOMETRY[template]
            const width = TAG_WIDTH * scale
            const height = TAG_HEIGHT * scale
            const slots = Array.from({ length: cols * rows }, (_, index) =>
                tagSlot(template, index),
            )

            for (const slot of slots) {
                expect(slot.x).toBeGreaterThanOrEqual(0)
                expect(slot.y).toBeGreaterThanOrEqual(0)
                expect(slot.x + width).toBeLessThanOrEqual(page[0])
                expect(slot.y + height).toBeLessThanOrEqual(page[1])
            }
            for (const [i, a] of slots.entries()) {
                for (const b of slots.slice(i + 1)) {
                    const apart =
                        a.x + width <= b.x ||
                        b.x + width <= a.x ||
                        a.y + height <= b.y ||
                        b.y + height <= a.y
                    expect(apart).toBe(true)
                }
            }
        },
    )

    it.each(TAG_TEMPLATES)(
        '%s starts a new page after a full sheet',
        (template) => {
            const { cols, rows } = TAG_GEOMETRY[template]
            const perPage = cols * rows
            expect(tagSlot(template, 0).newPage).toBe(false)
            expect(tagSlot(template, perPage - 1).newPage).toBe(false)
            expect(tagSlot(template, perPage)).toEqual({
                ...tagSlot(template, 0),
                newPage: true,
            })
        },
    )

    it('keeps the standard sheet of 8 at the existing positions', () => {
        expect(TAG_GEOMETRY.standard.page).toEqual([595.28, 841.89])
        expect(tagSlot('standard', 0)).toMatchObject({ x: 10, y: 20 })
        expect(tagSlot('standard', 7)).toMatchObject({ x: 305, y: 599 })
    })
})
