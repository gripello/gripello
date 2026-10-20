import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

vi.stubGlobal('ref', ref)
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('onMounted', (hook: () => void) => hook())
const unmountHooks: (() => void)[] = []
vi.stubGlobal('onBeforeUnmount', (hook: () => void) => unmountHooks.push(hook))

const { useLongPressDrag } = await import('~/composables/useLongPressDrag')

function setup() {
    const onDrop = vi.fn()
    const drag = useLongPressDrag<string>({
        targetAt: ({ y }) => (y > 500 ? 'done' : null),
        onDrop,
    })
    return { drag, onDrop }
}

describe('useLongPressDrag', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        unmountHooks.splice(0).forEach((hook) => hook())
        vi.useRealTimers()
    })

    it('lifts the item after a steady long press and drops it on a target', () => {
        const { drag, onDrop } = setup()
        drag.press('task-1', { x: 100, y: 100 })
        expect(drag.dragged.value).toBeNull()

        vi.advanceTimersByTime(350)
        expect(drag.dragged.value).toBe('task-1')

        expect(drag.move({ x: 120, y: 600 })).toBe(true)
        expect(drag.target.value).toBe('done')

        drag.release()
        expect(onDrop).toHaveBeenCalledWith('task-1', 'done', {
            x: 120,
            y: 600,
        })
        expect(drag.dragged.value).toBeNull()
    })

    it('treats movement before the delay as a scroll', () => {
        const { drag } = setup()
        drag.press('task-1', { x: 100, y: 100 })
        expect(drag.move({ x: 100, y: 130 })).toBe(false)

        vi.advanceTimersByTime(500)
        expect(drag.dragged.value).toBeNull()
    })

    it('ignores small jitter while holding', () => {
        const { drag } = setup()
        drag.press('task-1', { x: 100, y: 100 })
        drag.move({ x: 104, y: 103 })

        vi.advanceTimersByTime(350)
        expect(drag.dragged.value).toBe('task-1')
    })

    it('does nothing when released outside a target or as a short tap', () => {
        const { drag, onDrop } = setup()
        drag.press('task-1', { x: 100, y: 100 })
        drag.release()
        vi.advanceTimersByTime(500)
        expect(drag.dragged.value).toBeNull()

        drag.press('task-1', { x: 100, y: 100 })
        vi.advanceTimersByTime(350)
        drag.move({ x: 100, y: 200 })
        drag.release()
        expect(onDrop).not.toHaveBeenCalled()
    })

    it('claims the touchmove before bubble listeners like pull-to-refresh', () => {
        let preventedForLaterListeners = false
        const later = (event: Event) =>
            (preventedForLaterListeners = event.defaultPrevented)
        window.addEventListener('touchmove', later)
        const { drag } = setup()
        drag.press('task-1', { x: 100, y: 100 })
        vi.advanceTimersByTime(350)

        const event = new Event('touchmove', {
            bubbles: true,
            cancelable: true,
        })
        Object.defineProperty(event, 'touches', {
            value: [{ clientX: 100, clientY: 160 }],
        })
        document.body.dispatchEvent(event)
        window.removeEventListener('touchmove', later)

        expect(preventedForLaterListeners).toBe(true)
    })

    it('lets a mouse drag at once past the threshold and drops without targets', () => {
        const onDrop = vi.fn()
        const onMove = vi.fn()
        const onCancel = vi.fn()
        const drag = useLongPressDrag<string>({
            tolerance: 6,
            onDrop,
            onMove,
            onCancel,
        })
        drag.startPointer(
            new PointerEvent('pointerdown', {
                button: 0,
                pointerType: 'mouse',
                clientX: 10,
                clientY: 10,
            }),
            'route-1',
        )
        window.dispatchEvent(
            new PointerEvent('pointermove', { clientX: 12, clientY: 10 }),
        )
        expect(drag.dragged.value).toBeNull()
        window.dispatchEvent(
            new PointerEvent('pointermove', { clientX: 40, clientY: 30 }),
        )
        expect(drag.dragged.value).toBe('route-1')
        expect(onMove).toHaveBeenLastCalledWith('route-1', { x: 40, y: 30 })
        window.dispatchEvent(new PointerEvent('pointerup'))
        expect(onDrop).toHaveBeenCalledWith('route-1', '', { x: 40, y: 30 })

        window.dispatchEvent(
            new PointerEvent('pointermove', { clientX: 90, clientY: 90 }),
        )
        expect(drag.dragged.value).toBeNull()

        drag.startPointer(
            new PointerEvent('pointerdown', {
                button: 0,
                pointerType: 'touch',
                clientX: 10,
                clientY: 10,
            }),
            'route-2',
        )
        vi.advanceTimersByTime(350)
        window.dispatchEvent(new PointerEvent('pointercancel'))
        expect(onCancel).toHaveBeenCalledWith('route-2')
        expect(onDrop).toHaveBeenCalledTimes(1)
    })

    it('keeps a mouse press from selecting text and swallows the click after a drag', () => {
        const drag = useLongPressDrag<string>({ onDrop: vi.fn() })
        const down = new PointerEvent('pointerdown', {
            button: 0,
            pointerType: 'mouse',
            clientX: 10,
            clientY: 10,
            cancelable: true,
        })
        drag.startPointer(down, 'route-1')
        expect(down.defaultPrevented).toBe(true)
        window.dispatchEvent(
            new PointerEvent('pointermove', { clientX: 60, clientY: 60 }),
        )
        window.dispatchEvent(new PointerEvent('pointerup'))
        const onClick = vi.fn()
        document.body.addEventListener('click', onClick)
        const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        })
        document.body.dispatchEvent(click)
        expect(click.defaultPrevented).toBe(true)
        expect(onClick).not.toHaveBeenCalled()

        drag.startPointer(
            new PointerEvent('pointerdown', {
                button: 0,
                pointerType: 'mouse',
                clientX: 10,
                clientY: 10,
            }),
            'route-2',
        )
        window.dispatchEvent(new PointerEvent('pointerup'))
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        expect(onClick).toHaveBeenCalledOnce()
        document.body.removeEventListener('click', onClick)
    })
})
