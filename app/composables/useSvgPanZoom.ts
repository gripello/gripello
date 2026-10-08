import type { Ref } from 'vue'
import {
    fitViewBox,
    type MapBounds,
    type MapPoint,
    type ViewBox,
} from '#shared/utils/mapGeometry'
import {
    clampToBounds,
    fitBetweenInsets,
    flingVelocity,
    interpolateView,
    panBy,
    pinchView,
    screenToMap,
    wheelIntent,
    withAspect,
    zoomAt,
    type ScreenPoint,
} from '~/utils/panZoom'

interface PanZoomOptions {
    bounds: Ref<MapBounds>
    minWidth?: number
    maxPixelsPerUnit?: number
    canStartPan?: (event: PointerEvent) => boolean
    doubleClickZoom?: boolean
    insetBottom?: Ref<number>
}

const DRAG_THRESHOLD_PX = 6
const WHEEL_ZOOM_SPEED = 0.002
const PINCH_ZOOM_SPEED = 0.01
const KEY_PAN_FRACTION = 0.1
const ANIMATION_MS = 280
const INITIAL_ASPECT_RATIO = 3 / 4
const UNMEASURED_WIDTH_PX = 800
const DOUBLE_TAP_MS = 300
const CHIP_ROW_INSET_PX = 60
const DOUBLE_TAP_PX = 30
const VELOCITY_WINDOW_MS = 100
const FLING_START_SPEED = 0.3

const prefersReducedMotion = () =>
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useSvgPanZoom(options: PanZoomOptions) {
    const svgRef = ref<SVGSVGElement | null>(null)
    const viewBox = ref<ViewBox>(
        fitViewBox(options.bounds.value, INITIAL_ASPECT_RATIO, 0.5),
    )
    const size = ref({ width: 0, height: 0 })
    const isPanning = ref(false)
    let view = viewBox.value

    const unitsToPixels = (target: ViewBox) =>
        (size.value.width || UNMEASURED_WIDTH_PX) / Math.max(target.width, 0.01)
    const pixelsPerUnit = computed(() => unitsToPixels(viewBox.value))
    const viewBoxAttr = computed(() => {
        const { x, y, width, height } = viewBox.value
        return `${x} ${y} ${width} ${height}`
    })

    const aspectRatio = () =>
        size.value.height > 0 ? size.value.width / size.value.height : 1

    const limits = computed(() => {
        const bounds = options.bounds.value
        const width = bounds.maxX - bounds.minX
        const height = bounds.maxY - bounds.minY
        return {
            minWidth: Math.max(
                options.minWidth ?? 2,
                options.maxPixelsPerUnit
                    ? size.value.width / options.maxPixelsPerUnit
                    : 0,
            ),
            maxWidth: Math.max(width, height * aspectRatio(), 1) * 1.5,
        }
    })

    const pointers = new Map<number, ScreenPoint>()
    const samples: { x: number; y: number; time: number }[] = []
    let dragDistance = 0
    let dragged = false
    let renderFrame = 0
    let motionFrame = 0
    let pendingFit: { bounds: MapBounds; padding: number } | null = null
    let lastFit: { bounds: MapBounds; padding: number } | null = null
    let userMoved = false
    let lastTap: { x: number; y: number; time: number } | null = null
    let lastPointerType = 'mouse'
    let startedOnMap = false

    function rect() {
        return svgRef.value!.getBoundingClientRect()
    }

    function render() {
        if (renderFrame) return
        renderFrame = requestAnimationFrame(() => {
            renderFrame = 0
            viewBox.value = view
        })
    }

    function show(next: ViewBox) {
        view = next
        render()
    }

    function setView(next: ViewBox) {
        show(clampToBounds(next, options.bounds.value))
    }

    function jumpTo(next: ViewBox) {
        view = next
        viewBox.value = next
    }

    function toMap(client: ScreenPoint): MapPoint {
        return screenToMap(client, rect(), view)
    }

    function stopMotion() {
        if (motionFrame) cancelAnimationFrame(motionFrame)
        motionFrame = 0
    }

    function animateTo(target: ViewBox) {
        stopMotion()
        if (prefersReducedMotion()) {
            jumpTo(target)
            return
        }
        const from = view
        const start = performance.now()
        const step = (now: number) => {
            const progress = Math.min(1, (now - start) / ANIMATION_MS)
            jumpTo(interpolateView(from, target, progress))
            motionFrame = progress < 1 ? requestAnimationFrame(step) : 0
        }
        motionFrame = requestAnimationFrame(step)
    }

    function fling(initial: ScreenPoint) {
        stopMotion()
        let velocity: ScreenPoint | null = initial
        let previous = performance.now()
        const step = (now: number) => {
            const elapsed = now - previous
            previous = now
            if (!velocity) {
                motionFrame = 0
                return
            }
            const scale = unitsToPixels(view)
            setView(
                panBy(
                    view,
                    (-velocity.x * elapsed) / scale,
                    (-velocity.y * elapsed) / scale,
                ),
            )
            velocity = flingVelocity(velocity, elapsed)
            motionFrame = requestAnimationFrame(step)
        }
        motionFrame = requestAnimationFrame(step)
    }

    function fitView(bounds: MapBounds, padding: number) {
        return fitBetweenInsets(bounds, size.value, padding, {
            top: CHIP_ROW_INSET_PX,
            bottom: options.insetBottom?.value ?? 0,
        })
    }

    function fitTo(bounds: MapBounds, { padding = 1, animate = true } = {}) {
        if (!size.value.width) {
            pendingFit = { bounds, padding }
            return
        }
        lastFit = { bounds, padding }
        userMoved = false
        const target = fitView(bounds, padding)
        if (animate) animateTo(target)
        else jumpTo(target)
    }

    function fitAll(animate = false) {
        fitTo(options.bounds.value, { padding: 0.5, animate })
    }

    function zoomBy(factor: number, focus?: MapPoint) {
        stopMotion()
        userMoved = true
        const center: MapPoint = focus ?? [
            view.x + view.width / 2,
            view.y + view.height / 2,
        ]
        setView(zoomAt(view, center, factor, limits.value))
    }

    function recordSample(point: ScreenPoint) {
        const time = performance.now()
        samples.push({ ...point, time })
        while (samples.length && time - samples[0]!.time > VELOCITY_WINDOW_MS)
            samples.shift()
    }

    function releaseVelocity(): ScreenPoint | null {
        const first = samples[0]
        const last = samples.at(-1)
        samples.length = 0
        if (!first || !last || last.time === first.time) return null
        if (performance.now() - last.time > VELOCITY_WINDOW_MS / 2) return null
        const elapsed = last.time - first.time
        const velocity = {
            x: (last.x - first.x) / elapsed,
            y: (last.y - first.y) / elapsed,
        }
        return Math.hypot(velocity.x, velocity.y) >= FLING_START_SPEED
            ? velocity
            : null
    }

    function onPointerDown(event: PointerEvent) {
        lastPointerType = event.pointerType
        const target = event.target as Element
        if (target.closest('[data-pan-ignore]')) return
        if (options.canStartPan && !options.canStartPan(event)) return
        if (!pointers.size) startedOnMap = !!svgRef.value?.contains(target)
        stopMotion()
        const point = { x: event.clientX, y: event.clientY }
        pointers.set(event.pointerId, point)
        samples.length = 0
        recordSample(point)
        dragDistance = 0
        dragged = false
    }

    function onPointerMove(event: PointerEvent) {
        const previous = pointers.get(event.pointerId)
        if (!previous) return
        const current = { x: event.clientX, y: event.clientY }

        if (pointers.size === 1) {
            dragDistance += Math.hypot(
                current.x - previous.x,
                current.y - previous.y,
            )
            if (!dragged && dragDistance < DRAG_THRESHOLD_PX) return
            if (!dragged) {
                dragged = true
                userMoved = true
                isPanning.value = true
                svgRef.value?.setPointerCapture(event.pointerId)
            }
            const scale = unitsToPixels(view)
            setView(
                panBy(
                    view,
                    (previous.x - current.x) / scale,
                    (previous.y - current.y) / scale,
                ),
            )
            recordSample(current)
        } else if (pointers.size === 2) {
            dragged = true
            userMoved = true
            isPanning.value = true
            const other = [...pointers.entries()].find(
                ([id]) => id !== event.pointerId,
            )![1]
            setView(
                pinchView(
                    view,
                    rect(),
                    [previous, other],
                    [current, other],
                    limits.value,
                ),
            )
            samples.length = 0
        }
        pointers.set(event.pointerId, current)
    }

    function zoomOnDoubleTap(event: PointerEvent) {
        if (!options.doubleClickZoom || event.pointerType === 'mouse') return
        const tap = {
            x: event.clientX,
            y: event.clientY,
            time: event.timeStamp,
        }
        const isDouble =
            !!lastTap &&
            tap.time - lastTap.time < DOUBLE_TAP_MS &&
            Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_PX
        lastTap = isDouble ? null : tap
        if (isDouble) zoomBy(2, toMap(tap))
    }

    function onPointerUp(event: PointerEvent) {
        if (!pointers.has(event.pointerId)) return
        const wasSingle = pointers.size === 1
        pointers.delete(event.pointerId)
        if (pointers.size) {
            samples.length = 0
            return
        }
        isPanning.value = false
        if (!dragged) {
            if (startedOnMap) zoomOnDoubleTap(event)
            return
        }
        const velocity = wasSingle && event.type === 'pointerup'
        const release = velocity ? releaseVelocity() : null
        if (release && !prefersReducedMotion()) fling(release)
    }

    function onClickCapture(event: MouseEvent) {
        if (!dragged) return
        dragged = false
        event.stopImmediatePropagation()
        event.preventDefault()
    }

    function onWheel(event: WheelEvent) {
        event.preventDefault()
        stopMotion()
        if (wheelIntent(event) === 'pan') {
            userMoved = true
            const scale = unitsToPixels(view)
            setView(panBy(view, event.deltaX / scale, event.deltaY / scale))
            return
        }
        const delta = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY
        const speed = event.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED
        zoomBy(
            Math.exp(-delta * speed),
            toMap({ x: event.clientX, y: event.clientY }),
        )
    }

    function onDoubleClick(event: MouseEvent) {
        if (!options.doubleClickZoom || lastPointerType !== 'mouse') return
        zoomBy(2, toMap({ x: event.clientX, y: event.clientY }))
    }

    function onKeyDown(event: KeyboardEvent) {
        const step = view.width * KEY_PAN_FRACTION
        const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        }
        if (event.target !== svgRef.value) return
        if (event.key === '+' || event.key === '=') zoomBy(1.4)
        else if (event.key === '-') zoomBy(1 / 1.4)
        else if (moves[event.key]) {
            const [dx, dy] = moves[event.key]!
            userMoved = true
            setView(panBy(view, dx, dy))
        } else return
        event.preventDefault()
    }

    if (options.insetBottom)
        watch(options.insetBottom, () => {
            if (!userMoved && lastFit && size.value.width)
                animateTo(fitView(lastFit.bounds, lastFit.padding))
        })

    let resizeObserver: ResizeObserver | null = null

    function onResize(width: number, height: number) {
        const hadSize = size.value.width > 0
        size.value = { width, height }
        if (!width || !height) return
        if (hadSize && (userMoved || !lastFit)) {
            jumpTo(withAspect(view, aspectRatio()))
            return
        }
        if (hadSize && lastFit) {
            jumpTo(fitView(lastFit.bounds, lastFit.padding))
            return
        }
        const initial = pendingFit ?? {
            bounds: options.bounds.value,
            padding: 0.5,
        }
        pendingFit = null
        fitTo(initial.bounds, { padding: initial.padding, animate: false })
    }

    let gestureRoot: HTMLElement | null = null

    onMounted(() => {
        const svg = svgRef.value
        gestureRoot = svg?.parentElement ?? null
        if (!svg || !gestureRoot) return
        gestureRoot.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
        window.addEventListener('pointercancel', onPointerUp)
        gestureRoot.addEventListener('click', onClickCapture, true)
        svg.addEventListener('wheel', onWheel, { passive: false })
        svg.addEventListener('dblclick', onDoubleClick)
        svg.addEventListener('keydown', onKeyDown)

        resizeObserver = new ResizeObserver(([entry]) => {
            if (entry)
                onResize(entry.contentRect.width, entry.contentRect.height)
        })
        resizeObserver.observe(svg)
    })

    onBeforeUnmount(() => {
        stopMotion()
        if (renderFrame) cancelAnimationFrame(renderFrame)
        resizeObserver?.disconnect()
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
        gestureRoot?.removeEventListener('pointerdown', onPointerDown)
        gestureRoot?.removeEventListener('click', onClickCapture, true)
        const svg = svgRef.value
        if (!svg) return
        svg.removeEventListener('wheel', onWheel)
        svg.removeEventListener('dblclick', onDoubleClick)
        svg.removeEventListener('keydown', onKeyDown)
    })

    return {
        svgRef,
        viewBox,
        viewBoxAttr,
        size,
        pixelsPerUnit,
        isPanning,
        toMap,
        zoomBy,
        fitTo,
        fitAll,
        limits,
    }
}

export type SvgPanZoom = ReturnType<typeof useSvgPanZoom>
