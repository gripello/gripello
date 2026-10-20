import {
    BOULDER_GRADE_SYSTEMS,
    canonicalGrade,
    gradeLabels,
    isGradeSystem,
    type GradeSource,
} from '#shared/utils/grades'

export const FONT_FIRST_IRCRA = 9

export const V_FONT_SPANS = [
    1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1,
]

export interface GymBand {
    key: string
    color: string
    span: number
    name?: string
}

export interface BoulderBandSetting {
    name: string
    color: string
    to: string
}

export const DEFAULT_GYM_BANDS: GymBand[] = [
    { key: 'yellow', color: '#facc15', span: 4 },
    { key: 'orange', color: '#f97316', span: 2 },
    { key: 'blue', color: '#2563eb', span: 3 },
    { key: 'red', color: '#dc2626', span: 3 },
    { key: 'black', color: '#18181b', span: 12 },
]

export function gymBandsFrom(
    settings: BoulderBandSetting[] | null | undefined,
): GymBand[] {
    if (!settings?.length) return DEFAULT_GYM_BANDS
    const font = gradeLabels('font')
    let start = 0
    const bands = settings.flatMap((band, i): GymBand[] => {
        const end =
            i === settings.length - 1 ? font.length - 1 : font.indexOf(band.to)
        if (end < start) return []
        const span = end - start + 1
        start = end + 1
        return [
            { key: `custom-${i}`, name: band.name, color: band.color, span },
        ]
    })
    return bands.length ? bands : DEFAULT_GYM_BANDS
}

export function bandSettingsFrom(
    bands: GymBand[],
    nameOf: (band: GymBand) => string,
): BoulderBandSetting[] {
    const font = gradeLabels('font')
    let end = -1
    return bands.map((band) => {
        end += band.span
        return { name: nameOf(band), color: band.color, to: font[end]! }
    })
}

export interface BandRange {
    key: string
    font: [from: string, to: string]
    uiaa: [from: string, to: string]
    openStart: boolean
    openEnd: boolean
}

export function bandRanges(bands: GymBand[]): BandRange[] {
    const font = gradeLabels('font')
    const uiaa = gradeLabels('uiaa')
    const uiaaAt = (fontIndex: number) =>
        uiaa[Math.min(FONT_FIRST_IRCRA + fontIndex, uiaa.length) - 1]!
    let start = 0
    return bands.map((band, i) => {
        const end = start + band.span - 1
        const range: BandRange = {
            key: band.key,
            font: [font[start]!, font[end]!],
            uiaa: [uiaaAt(start), uiaaAt(end)],
            openStart: i === 0,
            openEnd: i === bands.length - 1,
        }
        start = end + 1
        return range
    })
}

export function gymBandFor(
    source: GradeSource | null | undefined,
    bands: GymBand[] = DEFAULT_GYM_BANDS,
): GymBand | null {
    const system = source?.grade_system
    if (!isGradeSystem(system) || !BOULDER_GRADE_SYSTEMS.includes(system))
        return null
    const grade = canonicalGrade(system, source?.grade)
    if (!grade) return null
    const position =
        system === 'font'
            ? gradeLabels('font').indexOf(grade)
            : V_FONT_SPANS.slice(0, gradeLabels('v').indexOf(grade)).reduce(
                  (sum, span) => sum + span,
                  0,
              )
    let end = 0
    return bands.find((band) => (end += band.span) > position) ?? null
}

export function bandBoundaries(settings: BoulderBandSetting[]): number[] {
    const font = gradeLabels('font')
    return settings.slice(0, -1).map((band) => font.indexOf(band.to))
}

export function moveBandBoundary(
    settings: BoulderBandSetting[],
    index: number,
    position: number,
): BoulderBandSetting[] {
    const font = gradeLabels('font')
    const boundaries = bandBoundaries(settings)
    const min = (boundaries[index - 1] ?? -1) + 1
    const max = (boundaries[index + 1] ?? font.length - 1) - 1
    const to = font[Math.min(Math.max(position, min), max)]!
    return settings.map((band, i) => (i === index ? { ...band, to } : band))
}

export function splitBand(
    settings: BoulderBandSetting[],
    index: number,
): BoulderBandSetting[] {
    const font = gradeLabels('font')
    const boundaries = bandBoundaries(settings)
    const start = (boundaries[index - 1] ?? -1) + 1
    const end = boundaries[index] ?? font.length - 1
    if (end <= start) return settings
    const middle = Math.floor((start + end - 1) / 2)
    const band = settings[index]!
    return [
        ...settings.slice(0, index),
        { ...band, to: font[middle]! },
        { name: '', color: '#888888', to: band.to },
        ...settings.slice(index + 1),
    ]
}
