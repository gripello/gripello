export const MAX_CROP_ZOOM = 4

export interface CropSize {
    width: number
    height: number
}

export interface CropState {
    centerX: number
    centerY: number
    zoom: number
}

export interface CropRect {
    x: number
    y: number
    width: number
    height: number
}

export function coverScale(frame: CropSize, image: CropSize): number {
    return Math.max(frame.width / image.width, frame.height / image.height)
}

export function initialCrop(image: CropSize): CropState {
    return { centerX: image.width / 2, centerY: image.height / 2, zoom: 1 }
}

export function clampCrop(
    state: CropState,
    frame: CropSize,
    image: CropSize,
): CropState {
    const zoom = Math.min(MAX_CROP_ZOOM, Math.max(1, state.zoom))
    const scale = coverScale(frame, image) * zoom
    const halfWidth = frame.width / scale / 2
    const halfHeight = frame.height / scale / 2
    return {
        zoom,
        centerX: Math.min(
            image.width - halfWidth,
            Math.max(halfWidth, state.centerX),
        ),
        centerY: Math.min(
            image.height - halfHeight,
            Math.max(halfHeight, state.centerY),
        ),
    }
}

export function panCrop(
    state: CropState,
    deltaX: number,
    deltaY: number,
    frame: CropSize,
    image: CropSize,
): CropState {
    const scale = coverScale(frame, image) * state.zoom
    return clampCrop(
        {
            ...state,
            centerX: state.centerX - deltaX / scale,
            centerY: state.centerY - deltaY / scale,
        },
        frame,
        image,
    )
}

export function cropRect(
    state: CropState,
    frame: CropSize,
    image: CropSize,
): CropRect {
    const scale = coverScale(frame, image) * state.zoom
    const width = frame.width / scale
    const height = frame.height / scale
    return {
        x: state.centerX - width / 2,
        y: state.centerY - height / 2,
        width,
        height,
    }
}
