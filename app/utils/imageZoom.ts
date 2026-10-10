import type { ScreenPoint } from '~/utils/panZoom'

export interface ImageZoom {
    scale: number
    x: number
    y: number
}

export const MAX_IMAGE_ZOOM = 5
export const DOUBLE_TAP_ZOOM = 3
export const PINCH_SPEED = 1.5
export const UNZOOMED: ImageZoom = { scale: 1, x: 0, y: 0 }

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

export function clampZoom(
    zoom: ImageZoom,
    size: { width: number; height: number },
): ImageZoom {
    const scale = clamp(zoom.scale, 1, MAX_IMAGE_ZOOM)
    return {
        scale,
        x: clamp(zoom.x, size.width * (1 - scale), 0),
        y: clamp(zoom.y, size.height * (1 - scale), 0),
    }
}

export function zoomAround(
    zoom: ImageZoom,
    focus: ScreenPoint,
    factor: number,
    size: { width: number; height: number },
): ImageZoom {
    const scale = clamp(zoom.scale * factor, 1, MAX_IMAGE_ZOOM)
    const ratio = scale / zoom.scale
    return clampZoom(
        {
            scale,
            x: focus.x - (focus.x - zoom.x) * ratio,
            y: focus.y - (focus.y - zoom.y) * ratio,
        },
        size,
    )
}

export function pinchZoom(
    zoom: ImageZoom,
    before: [ScreenPoint, ScreenPoint],
    after: [ScreenPoint, ScreenPoint],
    size: { width: number; height: number },
): ImageZoom {
    const distance = ([a, b]: [ScreenPoint, ScreenPoint]) =>
        Math.hypot(a.x - b.x, a.y - b.y)
    const middle = ([a, b]: [ScreenPoint, ScreenPoint]) => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    })
    const startDistance = distance(before)
    const from = middle(before)
    const to = middle(after)
    const zoomed =
        startDistance > 0
            ? zoomAround(
                  zoom,
                  from,
                  (distance(after) / startDistance) ** PINCH_SPEED,
                  size,
              )
            : zoom
    return clampZoom(
        { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y },
        size,
    )
}

export function toggleZoom(
    zoom: ImageZoom,
    focus: ScreenPoint,
    size: { width: number; height: number },
): ImageZoom {
    return zoom.scale > 1
        ? UNZOOMED
        : zoomAround(zoom, focus, DOUBLE_TAP_ZOOM, size)
}
