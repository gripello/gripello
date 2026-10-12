import { describe, expect, it } from 'vitest'
import { renderShadowImage, shadowCasters } from '~/utils/mapShadow'
import type { GymMap } from '#shared/utils/mapGeometry'

const square = (size: number): [number, number][] => [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
]

const map: GymMap = {
    width: 40,
    height: 30,
    shapes: [
        { kind: 'floor', points: square(40) },
        { kind: 'mat', points: square(4) },
        { kind: 'structure', points: square(2), level: 3 },
        { kind: 'path', points: square(3) },
    ],
}

function fakeDocument(withContext = true) {
    const calls: string[] = []
    const canvases: { width: number; height: number }[] = []
    const createElement = () => {
        const context = {
            fillStyle: '',
            shadowColor: '',
            shadowBlur: 0,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
            globalCompositeOperation: 'source-over',
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
            clearRect: () => {},
            drawImage: () => calls.push('draw tier'),
            fill() {
                calls.push(
                    this.globalCompositeOperation === 'destination-out'
                        ? 'cut'
                        : `shadow blur=${this.shadowBlur} dy=${this.shadowOffsetY}`,
                )
            },
        }
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => (withContext ? context : null),
            toDataURL: () => 'data:image/png;base64,shadow',
        }
        canvases.push(canvas)
        return canvas
    }
    return {
        calls,
        canvases,
        doc: { createElement } as unknown as Document,
    }
}

describe('map shadows', () => {
    it('lets mats, structures and walls cast shadows by height', () => {
        expect(
            shadowCasters(map, [{ outline: square(5) }, { outline: [] }]).map(
                (caster) => caster.depth,
            ),
        ).toEqual([0.05, 0.36, 0.3])
    })

    it('bakes blurred shadows into one image and cuts out the casters', () => {
        const { calls, canvases, doc } = fakeDocument()
        const casters = shadowCasters(map, [])
        expect(renderShadowImage(map, casters, doc)).toBe(
            'data:image/png;base64,shadow',
        )
        expect(canvases[0]).toMatchObject({ width: 1280, height: 960 })
        expect(calls).toEqual([
            'shadow blur=1.92 dy=1.6',
            'cut',
            'cut',
            'draw tier',
            'shadow blur=13.824 dy=11.52',
            'cut',
            'draw tier',
        ])
    })

    it('keeps the shadow of a taller caster on a lower one', () => {
        const { calls, doc } = fakeDocument()
        renderShadowImage(
            map,
            [
                { points: square(30), depth: 0.05 },
                { points: square(2), depth: 0.3 },
            ],
            doc,
        )
        const wallTier = calls.slice(calls.indexOf('draw tier') + 1)
        expect(wallTier).toEqual([
            'shadow blur=11.52 dy=9.6',
            'cut',
            'draw tier',
        ])
    })

    it('draws nothing without casters or a 2D canvas', () => {
        expect(renderShadowImage(map, [], fakeDocument().doc)).toBeNull()
        expect(
            renderShadowImage(
                map,
                shadowCasters(map, []),
                fakeDocument(false).doc,
            ),
        ).toBeNull()
    })
})
