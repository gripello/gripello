import { haptic } from '~/utils/haptics'

export interface DragPoint {
    x: number
    y: number
}

interface LongPressDragOptions<T> {
    targetAt?: (point: DragPoint) => string | null
    onDrop: (item: T, target: string, point: DragPoint) => void
    onMove?: (item: T, point: DragPoint) => void
    onLift?: (item: T) => void
    onCancel?: (item: T) => void
    delay?: number
    tolerance?: number
}

export function useLongPressDrag<T>(options: LongPressDragOptions<T>) {
    const delay = options.delay ?? 350
    const tolerance = options.tolerance ?? 10

    const dragged = shallowRef<T | null>(null)
    const position = ref<DragPoint | null>(null)
    const target = ref<string | null>(null)

    let pending: { item: T; origin: DragPoint; mouse: boolean } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let detachPointer: (() => void) | undefined

    function reset() {
        clearTimeout(timer)
        detachPointer?.()
        detachPointer = undefined
        pending = null
        dragged.value = null
        position.value = null
        target.value = null
    }

    function cancel() {
        const item = dragged.value
        reset()
        if (item !== null) options.onCancel?.(item)
    }

    function lift(item: T, point: DragPoint) {
        dragged.value = item
        position.value = point
        options.onLift?.(item)
        options.onMove?.(item, point)
    }

    function press(item: T, point: DragPoint, mouse = false) {
        reset()
        pending = { item, origin: point, mouse }
        if (mouse) return
        timer = setTimeout(() => {
            if (!pending) return
            void haptic('press')
            lift(pending.item, pending.origin)
        }, delay)
    }

    function move(point: DragPoint): boolean {
        if (dragged.value !== null) {
            position.value = point
            target.value = options.targetAt?.(point) ?? null
            options.onMove?.(dragged.value, point)
            return true
        }
        if (
            pending &&
            Math.hypot(point.x - pending.origin.x, point.y - pending.origin.y) >
                tolerance
        ) {
            if (!pending.mouse) {
                reset()
                return false
            }
            lift(pending.item, point)
            return true
        }
        return false
    }

    function release() {
        const item = dragged.value
        const dropTarget = target.value
        const point = position.value
        reset()
        if (item === null || !point) return
        if (dropTarget) options.onDrop(item, dropTarget, point)
        else if (!options.targetAt) options.onDrop(item, '', point)
    }

    function touchPoint(event: TouchEvent): DragPoint | null {
        const touch = event.touches[0] ?? event.changedTouches[0]
        return touch ? { x: touch.clientX, y: touch.clientY } : null
    }

    function startTouch(event: TouchEvent, item: T) {
        const point = touchPoint(event)
        if (point && event.touches.length === 1) press(item, point)
    }

    function swallowNextClick() {
        const swallow = (click: MouseEvent) => {
            click.preventDefault()
            click.stopPropagation()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() =>
            window.removeEventListener('click', swallow, { capture: true }),
        )
    }

    function startPointer(event: PointerEvent, item: T) {
        if (event.button !== 0) return
        const mouse = event.pointerType !== 'touch'
        if (mouse) event.preventDefault()
        press(item, { x: event.clientX, y: event.clientY }, mouse)
        const onPointerMove = (moveEvent: PointerEvent) => {
            if (move({ x: moveEvent.clientX, y: moveEvent.clientY }))
                moveEvent.preventDefault()
        }
        const onPointerUp = () => {
            if (mouse && dragged.value !== null) swallowNextClick()
            release()
        }
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', cancel)
        detachPointer = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', cancel)
        }
    }

    function onTouchMove(event: TouchEvent) {
        const point = touchPoint(event)
        if (point && move(point) && event.cancelable) event.preventDefault()
    }

    onMounted(() => {
        // capture runs before pull-to-refresh's bubble listener, which then sees defaultPrevented
        window.addEventListener('touchmove', onTouchMove, {
            passive: false,
            capture: true,
        })
        window.addEventListener('touchend', release)
        window.addEventListener('touchcancel', cancel)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('touchmove', onTouchMove, { capture: true })
        window.removeEventListener('touchend', release)
        window.removeEventListener('touchcancel', cancel)
        reset()
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
        startPointer,
    }
}
