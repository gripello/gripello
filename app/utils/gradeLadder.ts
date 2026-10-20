import { GRADE_TABLES, type GradeSystem } from '#shared/utils/grades'

export interface LadderBand {
    label: string
    lo: number
    hi: number
}

export function scaleBands(system: GradeSystem): LadderBand[] {
    const table = GRADE_TABLES[system]
    return table.map(([label, index], i) => {
        const prev = table[i - 1]?.[1]
        const next = table[i + 1]?.[1]
        const lo =
            prev === undefined
                ? index - (next! - index) / 2
                : (prev + index) / 2
        const hi =
            next === undefined
                ? index + (index - prev!) / 2
                : (index + next) / 2
        return { label, lo, hi }
    })
}

export function groupBands(
    bands: LadderBand[],
    groups: { label: string; span: number }[],
): LadderBand[] {
    let at = 0
    return groups.flatMap(({ label, span }) => {
        const first = bands[at]
        const last = bands[Math.min(at + span, bands.length) - 1]
        at += span
        return first && last ? [{ label, lo: first.lo, hi: last.hi }] : []
    })
}

export function clipBands(
    bands: LadderBand[],
    lo: number,
    hi: number,
): LadderBand[] {
    return bands
        .map((band) => ({
            ...band,
            lo: Math.max(band.lo, lo),
            hi: Math.min(band.hi, hi),
        }))
        .filter((band) => band.hi > band.lo)
}
