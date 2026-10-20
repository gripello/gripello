import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THUMBS, THUMB_SETS, thumbSrcset } from '#shared/utils/thumbs'

const goSource = readFileSync(
    'backend/internal/platform/blob/thumbs.go',
    'utf8',
)
const goSizes = [
    ...(
        goSource.match(/thumbSizes\s*=\s*\[\]string\{([^}]*)\}/)?.[1] ?? ''
    ).matchAll(/"(\d+x\d+)"/g),
].map((match) => match[1])

describe('thumb sizes', () => {
    it('only requests sizes the server renders', () => {
        expect(goSizes.length).toBeGreaterThan(0)
        for (const size of Object.values(THUMBS)) {
            expect(goSizes, size).toContain(size)
        }
    })

    it('names every size the app requests', () => {
        const literals = globSync('app/**/*.{ts,vue}').filter((file) =>
            /['"`]\d+x\d+['"`]/.test(readFileSync(file, 'utf8')),
        )
        expect(literals).toEqual([])
    })
})

describe('thumbSrcset', () => {
    it('offers every width of a set for a thumbnail url', () => {
        expect(
            thumbSrcset(
                '/api/files/tasks/t1/p.jpg?token=x&thumb=400x0',
                THUMB_SETS.photo,
            ),
        ).toBe(
            '/api/files/tasks/t1/p.jpg?token=x&thumb=400x0 400w, /api/files/tasks/t1/p.jpg?token=x&thumb=1200x0 1200w',
        )
    })

    it('leaves urls without a thumbnail alone', () => {
        expect(thumbSrcset('blob:abc', THUMB_SETS.avatar)).toBeUndefined()
        expect(
            thumbSrcset('https://x/a.png', THUMB_SETS.avatar),
        ).toBeUndefined()
        expect(thumbSrcset(null, THUMB_SETS.avatar)).toBeUndefined()
    })

    it('covers a slot at three times its size', () => {
        const largest = (set: readonly string[]) =>
            Math.max(...set.map((size) => Number(size.split('x')[0])))
        expect(largest(THUMB_SETS.avatar)).toBeGreaterThanOrEqual(
            112 * 3 * 0.95,
        )
        expect(largest(THUMB_SETS.banner)).toBeGreaterThanOrEqual(1200 * 2)
        expect(largest(THUMB_SETS.cover)).toBeGreaterThanOrEqual(1200 * 2)
    })
})
