import { haptic } from '~/utils/haptics'

export interface DragPoint {
    x: number
    y: number
}

interface LongPressDragOptions<T> {
    targetAt: (point: DragPoint) => string | null
    onDrop: (item: T, target: string) => void
    delay?: number
    tolerance?: number
}

export function useLongPressDrag<T>(options: LongPressDragOptions<T>) {
    const delay = options.delay ?? 350
    const tolerance = options.tolerance ?? 10

    const dragged = shallowRef<T | null>(null)
    const position = ref<DragPoint | null>(null)
    const target = ref<string | null>(null)

    let pending: { item: T; origin: DragPoint } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    function cancel() {
        clearTimeout(timer)
        pending = null
        dragged.value = null
        position.value = null
        target.value = null
    }

    function press(item: T, point: DragPoint) {
        cancel()
        pending = { item, origin: point }
        timer = setTimeout(() => {
            if (!pending) return
            dragged.value = pending.item
            position.value = pending.origin
            void haptic('press')
        }, delay)
    }

    function move(point: DragPoint): boolean {
        if (dragged.value !== null) {
            position.value = point
            target.value = options.targetAt(point)
            return true
        }
        if (
            pending &&
            Math.hypot(point.x - pending.origin.x, point.y - pending.origin.y) >
                tolerance
        )
            cancel()
        return false
    }

    function release() {
        const item = dragged.value
        const dropTarget = target.value
        cancel()
        if (item !== null && dropTarget) options.onDrop(item, dropTarget)
    }

    function touchPoint(event: TouchEvent): DragPoint | null {
        const touch = event.touches[0] ?? event.changedTouches[0]
        return touch ? { x: touch.clientX, y: touch.clientY } : null
    }

    function startTouch(event: TouchEvent, item: T) {
        const point = touchPoint(event)
        if (point && event.touches.length === 1) press(item, point)
    }

    function onTouchMove(event: TouchEvent) {
        const point = touchPoint(event)
        if (point && move(point) && event.cancelable) event.preventDefault()
    }

    onMounted(() => {
        window.addEventListener('touchmove', onTouchMove, { passive: false })
        window.addEventListener('touchend', release)
        window.addEventListener('touchcancel', cancel)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('touchend', release)
        window.removeEventListener('touchcancel', cancel)
        cancel()
    })

    return {
        dragged,
        position,
        target,
        press,
        move,
        release,
        cancel,
        startTouch,
    }
}
