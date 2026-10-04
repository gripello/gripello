import { describe, expect, it } from 'vitest'
import type { MapPoint } from '#shared/utils/mapGeometry'
import {
    closestPairDistance,
    clusterDots,
    checkPath,
    gradeFontPx,
    gradeSpacingPx,
    isolatedIds,
    spreadAround,
} from '~/utils/gymMap'

const dot = (routeId: string, point: MapPoint) => ({ routeId, point })

describe('clusterDots', () => {
    it('keeps far apart dots single', () => {
        const clusters = clusterDots([dot('a', [0, 0]), dot('b', [5, 0])], 1)
        expect(clusters.map((cluster) => cluster.key)).toEqual(['a', 'b'])
    })

    it('groups close dots and centers the cluster between them', () => {
        const [cluster] = clusterDots([dot('b', [0, 0]), dot('a', [0.5, 0])], 1)
        expect(cluster!.key).toBe('a,b')
        expect(cluster!.point).toEqual([0.25, 0])
    })

    it('splits a long chain of close dots into bounded clusters', () => {
        const chain = Array.from({ length: 30 }, (_, index) =>
            dot(`r${index}`, [index * 0.4, 0]),
        )
        const clusters = clusterDots(chain, 1)
        expect(clusters.length).toBeGreaterThan(5)
        for (const { dots } of clusters)
            expect(dots.at(-1)!.point[0] - dots[0]!.point[0]).toBeLessThan(1)
        expect(clusters.flatMap((cluster) => cluster.dots)).toHaveLength(30)
    })

    it('groups routes at the identical spot', () => {
        expect(
            clusterDots([dot('a', [3, 3]), dot('b', [3, 3])], 0.1),
        ).toHaveLength(1)
    })
})

describe('closestPairDistance', () => {
    it('finds the smallest gap', () => {
        expect(
            closestPairDistance([
                [0, 0],
                [3, 0],
                [3, 0.5],
            ]),
        ).toBe(0.5)
    })
})

describe('spreadAround', () => {
    it.each([2, 3, 8])(
        'keeps %i spread dots at least spacing apart',
        (count) => {
            const points = spreadAround([10, 10], count, 1)
            expect(points).toHaveLength(count)
            expect(closestPairDistance(points)).toBeGreaterThanOrEqual(0.999)
        },
    )
})

describe('isolatedIds', () => {
    it('keeps only markers without a neighbour inside the spacing', () => {
        const dots = [
            dot('a', [0, 0]),
            dot('b', [0.5, 0]),
            dot('c', [5, 0]),
            dot('d', [7, 0]),
        ]
        expect(isolatedIds(dots, 1)).toEqual(new Set(['c', 'd']))
    })

    it('excludes a marker close to only one member of a crowd', () => {
        const dots = [dot('a', [0, 0]), dot('b', [0.9, 0]), dot('c', [1.8, 0])]
        expect(isolatedIds(dots, 1)).toEqual(new Set())
    })

    it('isolates every marker once zoomed in far enough', () => {
        const dots = [dot('a', [0, 0]), dot('b', [0.5, 0])]
        expect(isolatedIds(dots, 0.5)).toEqual(new Set(['a', 'b']))
    })

    it('handles an empty map', () => {
        expect(isolatedIds([], 1)).toEqual(new Set())
    })
})

describe('gradeFontPx', () => {
    it('shrinks the font for longer grades', () => {
        expect(gradeFontPx('6A+')).toBe(11)
        expect(gradeFontPx('VIII')).toBe(9.5)
        expect(gradeFontPx('5.10a')).toBe(8)
    })
})

describe('gradeSpacingPx', () => {
    it('keeps grade circles and their badges apart', () => {
        expect(gradeSpacingPx(13)).toBe(40)
    })

    it('widens the spacing for coarse hit targets', () => {
        expect(gradeSpacingPx(22)).toBe(44)
    })
})

describe('checkPath', () => {
    it('draws a tick around the centre', () => {
        expect(checkPath([10, 10], 2)).toBe('M9 10 L9.8 10.8 L11.1 9.1')
    })
})
