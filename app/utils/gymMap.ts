import {
    labelPoint,
    pointAt,
    sanitizeWall,
    type GymMap,
    type MapPoint,
    type WallGeometry,
} from '#shared/utils/mapGeometry'
import { formatGrade } from '#shared/utils/grades'
import { readableTextOn, routeDotColor } from '~/utils/color'

export const NEW_ROUTE_DAYS = 7

export interface MapWall extends WallGeometry {
    id: string
    name: string
    sort: number
    labelAt: MapPoint
}

export interface MapRoute {
    id: string
    name: string
    color?: string | null
    grade?: string | null
    wall?: string | null
    wall_position?: number | null
    anchor_point?: number | null
    screw_date?: string | null
}

export interface RouteDot {
    routeId: string
    wallId: string
    point: MapPoint
    fill: string
    stroke: string
    grade: string
    isNew: boolean
}

export interface WallCount {
    total: number
    sent: number
}

export interface LabelBox {
    id: string
    x: number
    y: number
    width: number
    height: number
}

export function toMapWalls(
    records: {
        id: string
        name: string
        sort?: number | null
        outline?: unknown
        edge?: unknown
        label?: unknown
    }[],
    map: GymMap,
): MapWall[] {
    return records
        .flatMap((record) => {
            const geometry = sanitizeWall(record, map)
            if (!geometry) return []
            return [
                {
                    ...geometry,
                    id: record.id,
                    name: record.name,
                    sort: record.sort ?? 0,
                    labelAt: geometry.label ?? labelPoint(geometry.outline),
                },
            ]
        })
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

export function dotColors(color: string | null | undefined) {
    const fill = routeDotColor(color)
    return {
        fill,
        stroke: readableTextOn(fill) === '#FFFFFF' ? '#FFFFFF' : '#1A1A1A',
    }
}

export function isNewRoute(screwDate: string | null | undefined, now: Date) {
    if (!screwDate) return false
    const set = new Date(screwDate.replace(' ', 'T')).getTime()
    if (Number.isNaN(set)) return false
    return now.getTime() - set <= NEW_ROUTE_DAYS * 86_400_000
}

export function placeRoutes(
    walls: MapWall[],
    routes: MapRoute[],
    now = new Date(),
): RouteDot[] {
    const wallsById = new Map(walls.map((wall) => [wall.id, wall]))
    return routes.flatMap((route) => {
        const wall = route.wall ? wallsById.get(route.wall) : undefined
        if (!wall) return []
        return [
            {
                routeId: route.id,
                wallId: wall.id,
                point: pointAt(wall.edge, route.wall_position ?? 0.5),
                ...dotColors(route.color),
                grade: formatGrade(route),
                isNew: isNewRoute(route.screw_date, now),
            },
        ]
    })
}

export function wallCounts(
    routes: MapRoute[],
    sentIds: ReadonlySet<string>,
    matchingIds: ReadonlySet<string> | null,
): Map<string, WallCount> {
    const counts = new Map<string, WallCount>()
    for (const route of routes) {
        if (!route.wall || (matchingIds && !matchingIds.has(route.id))) continue
        const count = counts.get(route.wall) ?? { total: 0, sent: 0 }
        count.total += 1
        if (sentIds.has(route.id)) count.sent += 1
        counts.set(route.wall, count)
    }
    return counts
}

export function routesOnWall<Route extends MapRoute>(
    routes: Route[],
    wallId: string,
): Route[] {
    return routes
        .filter((route) => route.wall === wallId)
        .sort((a, b) => (a.wall_position ?? 0) - (b.wall_position ?? 0))
}

const overlaps = (a: LabelBox, b: LabelBox) =>
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height

export function visibleLabels(
    boxes: LabelBox[],
    alwaysShow: string | null,
): Set<string> {
    const placed: LabelBox[] = []
    const ordered = [
        ...boxes.filter((box) => box.id === alwaysShow),
        ...boxes.filter((box) => box.id !== alwaysShow),
    ]
    for (const box of ordered) {
        if (placed.some((other) => overlaps(box, other))) continue
        placed.push(box)
    }
    return new Set(placed.map((box) => box.id))
}

export interface Placement {
    wall: string | null
    position: number | null
}

export function applyPlacements<Route extends MapRoute>(
    routes: Route[],
    pending: ReadonlyMap<string, Placement>,
): Route[] {
    return routes.map((route) => {
        const placement = pending.get(route.id)
        return placement
            ? {
                  ...route,
                  wall: placement.wall,
                  wall_position: placement.position,
              }
            : route
    })
}

export function placementChanges(
    routes: MapRoute[],
    pending: ReadonlyMap<string, Placement>,
): { id: string; wall: string; wall_position: number | null }[] {
    return routes.flatMap((route) => {
        const placement = pending.get(route.id)
        if (!placement) return []
        const sameWall = (route.wall || null) === placement.wall
        const samePosition =
            (route.wall_position ?? null) === placement.position
        if (sameWall && (samePosition || !placement.wall)) return []
        return [
            {
                id: route.id,
                wall: placement.wall ?? '',
                wall_position: placement.wall ? placement.position : null,
            },
        ]
    })
}

export function clearOfDots(
    label: LabelBox,
    dots: { x: number; y: number }[],
    dotRadius: number,
    gap: number,
    direction: 1 | -1 = -1,
): LabelBox {
    const covers = (candidate: LabelBox) =>
        dots.some(
            (dot) =>
                Math.abs(dot.x - candidate.x) <
                    candidate.width / 2 + dotRadius &&
                Math.abs(dot.y - candidate.y) <
                    candidate.height / 2 + dotRadius,
        )
    const step = (label.height / 2 + gap) * direction
    for (const offset of [0, step, step * 2, -step, -step * 2]) {
        const candidate = { ...label, y: label.y + offset }
        if (!covers(candidate)) return candidate
    }
    return label
}

export interface DotCluster<Dot extends { routeId: string; point: MapPoint }> {
    key: string
    point: MapPoint
    dots: Dot[]
}

export function clusterDots<Dot extends { routeId: string; point: MapPoint }>(
    dots: Dot[],
    minDistance: number,
): DotCluster<Dot>[] {
    const groups: Dot[][] = []
    for (const dot of dots) {
        const group = groups.find((candidate) =>
            candidate.every(
                (other) =>
                    Math.hypot(
                        other.point[0] - dot.point[0],
                        other.point[1] - dot.point[1],
                    ) < minDistance,
            ),
        )
        if (group) group.push(dot)
        else groups.push([dot])
    }
    return groups.map((group) => ({
        key: group
            .map((dot) => dot.routeId)
            .sort()
            .join(','),
        point: [
            group.reduce((sum, dot) => sum + dot.point[0], 0) / group.length,
            group.reduce((sum, dot) => sum + dot.point[1], 0) / group.length,
        ],
        dots: group,
    }))
}

export function closestPairDistance(points: MapPoint[]): number {
    let closest = Infinity
    for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++)
            closest = Math.min(
                closest,
                Math.hypot(
                    points[i]![0] - points[j]![0],
                    points[i]![1] - points[j]![1],
                ),
            )
    return closest
}

export function spreadAround(
    center: MapPoint,
    count: number,
    spacing: number,
): MapPoint[] {
    const radius = Math.max(
        spacing * 0.8,
        spacing / 2 / Math.sin(Math.PI / Math.max(count, 2)),
    )
    return Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * 2 * Math.PI - Math.PI / 2
        return [
            center[0] + radius * Math.cos(angle),
            center[1] + radius * Math.sin(angle),
        ]
    })
}

export function isolatedIds(
    dots: { routeId: string; point: MapPoint }[],
    minDistance: number,
): Set<string> {
    return new Set(
        dots
            .filter((dot) =>
                dots.every(
                    (other) =>
                        other === dot ||
                        Math.hypot(
                            other.point[0] - dot.point[0],
                            other.point[1] - dot.point[1],
                        ) >= minDistance,
                ),
            )
            .map((dot) => dot.routeId),
    )
}

export function gradeFontPx(grade: string): number {
    if (grade.length <= 3) return 11
    return grade.length === 4 ? 9.5 : 8
}

export const DOT_RADIUS_PX = 5.5
export const GRADE_RADIUS_PX = 14
export const BADGE_RADIUS_PX = 6
export const GRADE_SPACING_PX = GRADE_RADIUS_PX * 2 + 4
export const HIT_RADIUS_PX = { fine: 13, coarse: 22 }

export function checkPath([x, y]: MapPoint, r: number): string {
    return `M${x - r * 0.5} ${y} L${x - r * 0.1} ${y + r * 0.4} L${x + r * 0.55} ${y - r * 0.45}`
}

export function exclamationPath([x, y]: MapPoint, r: number): string {
    return `M${x} ${y - r * 0.5} L${x} ${y + r * 0.1} M${x} ${y + r * 0.45} L${x} ${y + r * 0.46}`
}

export function sparklePath([x, y]: MapPoint, r: number): string {
    const tip = r * 0.6
    const waist = r * 0.15
    return `M${x} ${y - tip} L${x + waist} ${y - waist} L${x + tip} ${y} L${x + waist} ${y + waist} L${x} ${y + tip} L${x - waist} ${y + waist} L${x - tip} ${y} L${x - waist} ${y - waist} Z`
}
