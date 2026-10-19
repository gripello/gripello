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
        expect(onDrop).toHaveBeenCalledWith('task-1', 'done')
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
})
