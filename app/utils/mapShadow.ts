import type { GymMap, MapPoint } from '#shared/utils/mapGeometry'

export interface ShadowCaster {
    points: MapPoint[]
    depth: number
}

// Depths in metres, so shadows scale with the map like real height does.
const STRUCTURE_DEPTHS = [0.14, 0.24, 0.36]
const MAT_DEPTH = 0.05
const WALL_DEPTH = 0.3
const MAX_SIDE_PX = 2048
const MAX_PX_PER_METRE = 32

export function shadowCasters(
    map: GymMap,
    walls: { outline: MapPoint[] }[],
): ShadowCaster[] {
    const shapes = map.shapes.flatMap((shape) => {
        if (shape.kind === 'mat')
            return [{ points: shape.points, depth: MAT_DEPTH }]
        if (shape.kind !== 'structure') return []
        const depth =
            STRUCTURE_DEPTHS[(shape.level ?? 1) - 1] ?? STRUCTURE_DEPTHS[0]!
        return [{ points: shape.points, depth }]
    })
    const wallCasters = walls
        .filter((wall) => wall.outline.length >= 3)
        .map((wall) => ({ points: wall.outline, depth: WALL_DEPTH }))
    return [...shapes, ...wallCasters]
}

// Blurred shadows baked into one image once per map change: SVG filters re-render on every
// pan frame and stall iOS Safari, a scaled image costs nothing.
export function renderShadowImage(
    map: GymMap,
    casters: ShadowCaster[],
    doc: Document = document,
): string | null {
    if (!casters.length) return null
    const scale = Math.min(
        MAX_PX_PER_METRE,
        MAX_SIDE_PX / Math.max(map.width, map.height),
    )
    const canvas = doc.createElement('canvas')
    canvas.width = Math.ceil(map.width * scale)
    canvas.height = Math.ceil(map.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return null

    const layer = doc.createElement('canvas')
    layer.width = canvas.width
    layer.height = canvas.height
    const tier = layer.getContext('2d')
    if (!tier) return null

    const trace = (
        target: CanvasRenderingContext2D,
        points: MapPoint[],
        shiftX = 0,
    ) => {
        target.beginPath()
        points.forEach(([x, y], index) => {
            const px = x * scale + shiftX
            const py = y * scale
            if (index) target.lineTo(px, py)
            else target.moveTo(px, py)
        })
        target.closePath()
    }

    // Each height tier only loses the footprints of casters at least as tall, so a wall's shadow
    // still falls onto a mat while nothing darkens the shape that casts it.
    const away = canvas.width + 100
    const depths = [...new Set(casters.map((caster) => caster.depth))].sort(
        (a, b) => a - b,
    )
    for (const depth of depths) {
        tier.globalCompositeOperation = 'source-over'
        tier.clearRect(0, 0, layer.width, layer.height)
        tier.fillStyle = '#000'
        tier.shadowColor = '#000'
        tier.shadowBlur = depth * scale * 1.2
        tier.shadowOffsetX = away + depth * scale * 0.5
        tier.shadowOffsetY = depth * scale
        for (const caster of casters.filter((item) => item.depth === depth)) {
            trace(tier, caster.points, -away)
            tier.fill()
        }
        tier.shadowColor = 'transparent'
        tier.globalCompositeOperation = 'destination-out'
        for (const caster of casters.filter((item) => item.depth >= depth)) {
            trace(tier, caster.points)
            tier.fill()
        }
        context.drawImage(layer, 0, 0)
    }
    return canvas.toDataURL('image/png')
}
