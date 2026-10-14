export const GRADE_SYSTEMS = ['uiaa', 'french', 'yds', 'font', 'v'] as const
export type GradeSystem = (typeof GRADE_SYSTEMS)[number]

export const ROUTE_GRADE_SYSTEMS: GradeSystem[] = ['uiaa', 'french', 'yds']
export const BOULDER_GRADE_SYSTEMS: GradeSystem[] = ['font', 'v']
export const DEFAULT_ROUTE_GRADE_SYSTEM: GradeSystem = 'uiaa'
export const DEFAULT_BOULDER_GRADE_SYSTEM: GradeSystem = 'font'

type GradeTable = [label: string, index: number][]

export const GRADE_TABLES: Record<GradeSystem, GradeTable> = {
    uiaa: [
        ['1', 1],
        ['2', 1.9],
        ['3', 2.8],
        ['3+', 3.7],
        ['4', 4.6],
        ['4+', 5.5],
        ['5-', 6.4],
        ['5', 7.4],
        ['5+', 8.3],
        ['6-', 9.2],
        ['6', 10.1],
        ['6+', 11],
        ['7-', 12.1],
        ['7', 13.4],
        ['7+', 14.6],
        ['8-', 15.9],
        ['8', 17.1],
        ['8+', 18.4],
        ['9-', 19.6],
        ['9', 20.9],
        ['9+', 22],
        ['10-', 23.4],
        ['10', 24.6],
        ['10+', 26],
        ['11-', 27.1],
        ['11', 28.4],
        ['11+', 29.6],
        ['12-', 31],
        ['12', 32.1],
    ],
    french: [
        ['1', 1],
        ['2', 2],
        ['2+', 3],
        ['3-', 4],
        ['3', 5],
        ['3+', 6],
        ['4', 7],
        ['4+', 8],
        ['5', 9],
        ['5+', 10],
        ['6a', 11],
        ['6a+', 12],
        ['6b', 13],
        ['6b+', 14],
        ['6c', 15],
        ['6c+', 16],
        ['7a', 17],
        ['7a+', 18],
        ['7b', 19],
        ['7b+', 20],
        ['7c', 21],
        ['7c+', 22],
        ['8a', 23],
        ['8a+', 24],
        ['8b', 25],
        ['8b+', 26],
        ['8c', 27],
        ['8c+', 28],
        ['9a', 29],
        ['9a+', 30],
        ['9b', 31],
        ['9b+', 32],
    ],
    yds: [
        ['5.1', 1],
        ['5.2', 2],
        ['5.3', 3],
        ['5.4', 4],
        ['5.5', 5],
        ['5.6', 6],
        ['5.7', 7],
        ['5.8', 8],
        ['5.9', 9],
        ['5.10a', 10],
        ['5.10b', 11],
        ['5.10c', 12],
        ['5.10d', 13],
        ['5.11a', 14],
        ['5.11b', 15],
        ['5.11c', 16],
        ['5.11d', 17],
        ['5.12a', 18],
        ['5.12b', 19],
        ['5.12c', 20],
        ['5.12d', 21],
        ['5.13a', 22],
        ['5.13b', 23],
        ['5.13c', 24],
        ['5.13d', 25],
        ['5.14a', 26],
        ['5.14b', 27],
        ['5.14c', 28],
        ['5.14d', 29],
        ['5.15a', 30],
        ['5.15b', 31],
        ['5.15c', 32],
    ],
    font: [
        ['<2', 9],
        ['3', 10.9],
        ['4', 12.1],
        ['4+', 13.3],
        ['5', 14.2],
        ['5+', 15],
        ['6A', 15.7],
        ['6A+', 16.4],
        ['6B', 17.1],
        ['6B+', 17.9],
        ['6C', 18.7],
        ['6C+', 19.4],
        ['7A', 20.3],
        ['7A+', 21.3],
        ['7B', 22.4],
        ['7B+', 23.3],
        ['7C', 24.3],
        ['7C+', 25.3],
        ['8A', 26.3],
        ['8A+', 27.3],
        ['8B', 28.4],
        ['8B+', 29.6],
        ['8C', 30.7],
        ['8C+', 31.9],
    ],
    v: [
        ['VB', 9],
        ['V0-', 10.9],
        ['V0', 12.1],
        ['V0+', 13.3],
        ['V1', 14.4],
        ['V2', 15.6],
        ['V3', 16.8],
        ['V4', 17.9],
        ['V5', 19.1],
        ['V6', 20.3],
        ['V7', 21.5],
        ['V8', 22.6],
        ['V9', 23.8],
        ['V10', 24.9],
        ['V11', 26.1],
        ['V12', 27.3],
        ['V13', 28.4],
        ['V14', 29.6],
        ['V15', 30.7],
        ['V16', 31.9],
    ],
}

const LEGACY_UIAA_ALIASES: Record<string, string> = {
    '1-': '1',
    '1+': '1',
    '2-': '2',
    '2+': '2',
    '3-': '3',
    '4-': '3+',
}

export interface GradeSource {
    grade?: string | null
    grade_system?: string | null
    grade_index?: number | null
}

export function isGradeSystem(value: unknown): value is GradeSystem {
    return GRADE_SYSTEMS.includes(value as GradeSystem)
}

export function gradeLabels(system: GradeSystem): string[] {
    return GRADE_TABLES[system].map(([label]) => label)
}

export function gradesAround(
    system: GradeSystem,
    grade: string | null | undefined,
    steps: number,
): string[] {
    const labels = gradeLabels(system)
    const center = labels.indexOf(canonicalGrade(system, grade) ?? '')
    if (center < 0) return labels
    return labels.slice(Math.max(0, center - steps), center + steps + 1)
}

function findGrade(
    system: string | null | undefined,
    grade: string | null | undefined,
) {
    if (!isGradeSystem(system) || !grade) return undefined
    const normalized = grade.replace(/\s+/g, '').toLowerCase()
    return GRADE_TABLES[system].find(
        ([label]) => label.toLowerCase() === normalized,
    )
}

export function gradeIndex(
    system: string | null | undefined,
    grade: string | null | undefined,
): number | null {
    return findGrade(system, grade)?.[1] ?? null
}

export function canonicalGrade(
    system: string | null | undefined,
    grade: string | null | undefined,
): string | null {
    return findGrade(system, grade)?.[0] ?? null
}

export const GRADE_SYSTEM_SHORT: Record<GradeSystem, string> = {
    uiaa: 'UIAA',
    french: 'Fr',
    yds: 'YDS',
    font: 'Font',
    v: 'Hueco',
}

const SYSTEM_SUFFIX = ' · '

export function gradeKey(source: GradeSource, withSystem: boolean): string {
    const grade = formatGrade(source)
    if (!grade) return '?'
    return withSystem && isGradeSystem(source.grade_system)
        ? `${grade}${SYSTEM_SUFFIX}${GRADE_SYSTEM_SHORT[source.grade_system]}`
        : grade
}

function gradeKeyIndexes(key: string): Map<GradeSystem, number> {
    const [grade, short] = key.split(SYSTEM_SUFFIX)
    const systems = short
        ? GRADE_SYSTEMS.filter((system) => GRADE_SYSTEM_SHORT[system] === short)
        : GRADE_SYSTEMS
    const indexesBy = (
        match: (system: GradeSystem) => GradeTable[number] | undefined,
    ) =>
        new Map(
            systems.flatMap((system) => {
                const entry = match(system)
                return entry ? [[system, entry[1]] as const] : []
            }),
        )
    const exact = indexesBy((system) =>
        GRADE_TABLES[system].find(([label]) => label === grade),
    )
    return exact.size ? exact : indexesBy((system) => findGrade(system, grade))
}

export function compareGradeKeys(left: string, right: string): number {
    const leftIndexes = gradeKeyIndexes(left)
    const rightIndexes = gradeKeyIndexes(right)
    const sharedSystem = GRADE_SYSTEMS.find(
        (system) => leftIndexes.has(system) && rightIndexes.has(system),
    )
    if (sharedSystem)
        return leftIndexes.get(sharedSystem)! - rightIndexes.get(sharedSystem)!
    const lowest = (indexes: Map<GradeSystem, number>) =>
        indexes.size ? Math.min(...indexes.values()) : Number.MAX_SAFE_INTEGER
    return lowest(leftIndexes) - lowest(rightIndexes)
}

export function nearestGrade(system: GradeSystem, index: number): string {
    return GRADE_TABLES[system].reduce((best, entry) =>
        Math.abs(entry[1] - index) < Math.abs(best[1] - index) ? entry : best,
    )[0]
}

export function formatGrade(source: GradeSource | null | undefined): string {
    return source?.grade?.trim() ?? ''
}

export interface ImportedGrading {
    grade?: unknown
    grade_system?: unknown
    difficulty?: unknown
    difficulty_sign?: unknown
}

function legacySign(value: unknown): string {
    if (value === true || value === '+') return '+'
    if (value === false || value === '-') return '-'
    return ''
}

export function resolveImportedGrading(
    source: ImportedGrading,
    targetSystem: GradeSystem,
): Required<GradeSource> {
    if (
        isGradeSystem(source.grade_system) &&
        typeof source.grade === 'string'
    ) {
        const entry = findGrade(source.grade_system, source.grade)
        if (entry)
            return {
                grade: entry[0],
                grade_system: source.grade_system,
                grade_index: entry[1],
            }
    }
    const legacyLabel = `${source.difficulty ?? ''}${legacySign(source.difficulty_sign)}`
    const legacyGrade = LEGACY_UIAA_ALIASES[legacyLabel] ?? legacyLabel
    const legacyIndex = gradeIndex('uiaa', legacyGrade)
    if (legacyIndex === null)
        return { grade: '', grade_system: targetSystem, grade_index: null }
    if (!BOULDER_GRADE_SYSTEMS.includes(targetSystem))
        return {
            grade: legacyGrade,
            grade_system: 'uiaa',
            grade_index: legacyIndex,
        }
    const grade = nearestGrade(targetSystem, legacyIndex)
    return {
        grade,
        grade_system: targetSystem,
        grade_index: gradeIndex(targetSystem, grade),
    }
}
