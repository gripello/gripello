import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useSvgPanZoom } from '~/composables/useSvgPanZoom'
import type { MapBounds } from '#shared/utils/mapGeometry'

const BOUNDS: MapBounds = { minX: 0, minY: 0, maxX: 40, maxY: 30 }

let frames: FrameRequestCallback[] = []
let resize: (width: number, height: number) => void

function flush() {
    const pending = frames
    frames = []
    pending.forEach((frame) => frame(performance.now()))
}

beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
        frames.push(frame)
        return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: ResizeObserverCallback) {
                resize = (width, height) =>
                    callback(
                        [{ contentRect: { width, height } }] as never,
                        this as never,
                    )
            }
            observe() {}
            disconnect() {}
        },
    )
})

function setup(options: Partial<Parameters<typeof useSvgPanZoom>[0]> = {}) {
    let panZoom!: ReturnType<typeof useSvgPanZoom>
    const clicks = vi.fn()
    const wrapper = mount(
        defineComponent({
            setup() {
                panZoom = useSvgPanZoom({ bounds: ref(BOUNDS), ...options })
                return () =>
                    h('div', { onClick: clicks }, [
                        h('svg', { ref: panZoom.svgRef, tabindex: 0 }, [
                            h('rect', { id: 'wall' }),
                            h('rect', { id: 'handle', 'data-pan-ignore': '' }),
                        ]),
                    ])
            },
        }),
        { attachTo: document.body },
    )
    const svg = wrapper.find('svg').element as unknown as SVGSVGElement
    svg.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
    svg.setPointerCapture = () => {}
    resize(800, 600)
    const fitted = { ...panZoom.viewBox.value }

    const pointer = (
        type: string,
        target: Element,
        x: number,
        y: number,
        extra: PointerEventInit = {},
    ) =>
        target.dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                ...extra,
            }),
        )
    const wall = wrapper.find('#wall').element
    return { wrapper, panZoom, svg, wall, clicks, fitted, pointer }
}

describe('useSvgPanZoom', () => {
    it('fits the whole map once the canvas is measured', () => {
        const { fitted } = setup()
        expect(fitted.width).toBeGreaterThan(0)
        expect(fitted.x + fitted.width / 2).toBeCloseTo(20)
    })

    it('pans on a drag and swallows the click that ends it', () => {
        const { panZoom, wall, clicks, fitted, pointer } = setup()
        pointer('pointerdown', wall, 400, 300)
        pointer('pointermove', window as never, 380, 300)
        expect(panZoom.isPanning.value).toBe(true)
        pointer('pointerup', window as never, 380, 300)
        flush()
        expect(panZoom.viewBox.value.x).toBeGreaterThan(fitted.x)

        wall.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(clicks).not.toHaveBeenCalled()
        wall.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(clicks).toHaveBeenCalledOnce()
    })

    it('treats a jitter below the drag threshold as a click', () => {
        const { panZoom, wall, clicks, fitted, pointer } = setup()
        pointer('pointerdown', wall, 400, 300)
        pointer('pointermove', window as never, 403, 300)
        pointer('pointerup', window as never, 403, 300)
        flush()
        expect(panZoom.viewBox.value).toEqual(fitted)
        wall.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(clicks).toHaveBeenCalledOnce()
    })

    it('leaves handles marked data-pan-ignore to their own drag', () => {
        const { panZoom, wrapper, fitted, pointer } = setup()
        const handle = wrapper.find('#handle').element
        pointer('pointerdown', handle, 400, 300)
        pointer('pointermove', window as never, 300, 300)
        flush()
        expect(panZoom.isPanning.value).toBe(false)
        expect(panZoom.viewBox.value).toEqual(fitted)
    })

    it('pans and zooms from the keyboard only while the map has focus', () => {
        const { panZoom, svg, fitted } = setup()
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: '+', bubbles: true }),
        )
        expect(panZoom.viewBox.value).toEqual(fitted)

        const key = (name: string) => {
            const event = new KeyboardEvent('keydown', {
                key: name,
                cancelable: true,
            })
            svg.dispatchEvent(event)
            flush()
            return event
        }
        expect(key('+').defaultPrevented).toBe(true)
        expect(panZoom.viewBox.value.width).toBeCloseTo(fitted.width / 1.4)
        key('-')
        expect(panZoom.viewBox.value.width).toBeCloseTo(fitted.width)
        const before = panZoom.viewBox.value.x
        key('ArrowRight')
        expect(panZoom.viewBox.value.x).toBeGreaterThan(before)
        expect(key('a').defaultPrevented).toBe(false)
    })

    it('never zooms past the configured limits', () => {
        const { panZoom } = setup({ minWidth: 5 })
        for (let i = 0; i < 20; i++) panZoom.zoomBy(2)
        flush()
        expect(panZoom.viewBox.value.width).toBeCloseTo(5)
        for (let i = 0; i < 20; i++) panZoom.zoomBy(0.5)
        flush()
        expect(panZoom.viewBox.value.width).toBeCloseTo(
            panZoom.limits.value.maxWidth,
        )
    })

    it('zooms in on a touch double tap but not on two slow taps', () => {
        const { panZoom, wall, fitted, pointer } = setup({
            doubleClickZoom: true,
        })
        const tap = (time: number) => {
            const extra = { pointerType: 'touch' }
            pointer('pointerdown', wall, 400, 300, extra)
            window.dispatchEvent(
                Object.defineProperty(
                    new PointerEvent('pointerup', {
                        clientX: 400,
                        clientY: 300,
                        pointerId: 1,
                        ...extra,
                    }),
                    'timeStamp',
                    { value: time },
                ),
            )
            flush()
        }
        tap(1000)
        tap(2000)
        expect(panZoom.viewBox.value.width).toBeCloseTo(fitted.width)
        tap(2100)
        expect(panZoom.viewBox.value.width).toBeCloseTo(fitted.width / 2)
    })

    it('applies a fit requested before the canvas was measured', () => {
        let panZoom!: ReturnType<typeof useSvgPanZoom>
        mount(
            defineComponent({
                setup() {
                    panZoom = useSvgPanZoom({ bounds: ref(BOUNDS) })
                    panZoom.fitTo({ minX: 10, minY: 10, maxX: 12, maxY: 12 })
                    return () => h('div', [h('svg', { ref: panZoom.svgRef })])
                },
            }),
        )
        resize(800, 600)
        const { x, width } = panZoom.viewBox.value
        expect(width).toBeLessThan(20)
        expect(x + width / 2).toBeCloseTo(11)
    })

    it('stops following the pointer after unmount', () => {
        const { panZoom, wall, wrapper, pointer } = setup()
        pointer('pointerdown', wall, 400, 300)
        wrapper.unmount()
        const before = { ...panZoom.viewBox.value }
        pointer('pointermove', window as never, 100, 100)
        flush()
        expect(panZoom.viewBox.value).toEqual(before)
    })
})
