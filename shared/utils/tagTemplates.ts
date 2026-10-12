export const TAG_TEMPLATES = ['standard', 'large', 'compact', 'label'] as const

export type TagTemplate = (typeof TAG_TEMPLATES)[number]

export interface TagGeometry {
    page: [number, number]
    cols: number
    rows: number
    scale: number
    x0: number
    y0: number
    dx: number
    dy: number
}

const A4: [number, number] = [595.28, 841.89]

export const TAG_GEOMETRY: Record<TagTemplate, TagGeometry> = {
    standard: {
        page: A4,
        cols: 2,
        rows: 4,
        scale: 1,
        x0: 10,
        y0: 20,
        dx: 295,
        dy: 193,
    },
    large: {
        page: [A4[1], A4[0]],
        cols: 2,
        rows: 2,
        scale: 1.4,
        x0: 19,
        y0: 45,
        dx: 412,
        dy: 268,
    },
    compact: {
        page: A4,
        cols: 2,
        rows: 6,
        scale: 0.75,
        x0: 65,
        y0: 17,
        dx: 255,
        dy: 136,
    },
    label: {
        page: [300, 190],
        cols: 1,
        rows: 1,
        scale: 1,
        x0: 10,
        y0: 10,
        dx: 0,
        dy: 0,
    },
}

export function isTagTemplate(value: unknown): value is TagTemplate {
    return TAG_TEMPLATES.includes(value as TagTemplate)
}

export function tagSlot(template: TagTemplate, index: number) {
    const { cols, rows, x0, y0, dx, dy } = TAG_GEOMETRY[template]
    const onPage = index % (cols * rows)
    return {
        newPage: index > 0 && onPage === 0,
        x: x0 + (onPage % cols) * dx,
        y: y0 + Math.floor(onPage / cols) * dy,
    }
}
