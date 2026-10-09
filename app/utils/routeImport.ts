import { gradeIndex, type ImportedGrading } from '#shared/utils/grades'
import { normalizeHexColor } from '#shared/utils/color'
import { localDateYYYYMMDD } from '#shared/utils/formatting'

export interface ImportedRating extends ImportedGrading {
    rating?: unknown
    comment?: unknown
    created?: unknown
}

export interface ImportedRoute extends ImportedGrading {
    name?: unknown
    anchor_point?: unknown
    location?: unknown
    type?: string | null
    comment?: unknown
    creator?: unknown
    screw_date?: string | null
    color?: string | null
    archived?: unknown
    wall?: unknown
    wall_position?: unknown
    ratings?: ImportedRating[]
    source_id?: string
}

export interface ImportedReview {
    routeKey: string
    routeName: string
    location: string
    rating: number | null
    grade?: string
    grade_system?: string
    comment: string
    created: string | null
}

export const ROUTE_IMPORT_FIELDS = [
    'source_id',
    'name',
    'grade',
    'grade_system',
    'type',
    'location',
    'wall',
    'anchor_point',
    'color',
    'creator',
    'screw_date',
    'comment',
    'archived',
] as const
export type RouteImportField = (typeof ROUTE_IMPORT_FIELDS)[number]
export type RouteImportMapping = Partial<Record<RouteImportField, string>>

export const REVIEW_IMPORT_FIELDS = [
    'route',
    'route_name',
    'location',
    'rating',
    'grade',
    'grade_system',
    'comment',
    'created',
] as const
export type ReviewImportField = (typeof REVIEW_IMPORT_FIELDS)[number]
export type ReviewImportMapping = Partial<Record<ReviewImportField, string>>
export type ImportField = RouteImportField | ReviewImportField

export interface ImportTable {
    headers: string[]
    rows: Record<string, unknown>[]
}

const FIELD_ALIASES: Partial<Record<ImportField, string[]>> = {
    source_id: ['id', 'old id', 'route id'],
    route: ['route id', 'climb id'],
    route_name: ['route', 'route name'],
    rating: ['stars', 'score'],
    comment: ['text', 'review', 'note'],
    created: ['date', 'created at', 'review date'],
    grade: ['difficulty'],
    anchor_point: ['anchor'],
    creator: ['setters', 'setter', 'creators', 'setter.name'],
    screw_date: ['set on', 'date', 'date set', 'date live start'],
    type: ['climb type'],
    color: ['hold color.color', 'hold.color'],
    wall: ['wall.name loc', 'wall.name'],
}

const PASSTHROUGH_KEYS = [
    'difficulty',
    'difficulty_sign',
    'wall_position',
    'ratings',
] as const

const normalizeHeader = (value: string) =>
    value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export function guessImportMapping<Field extends ImportField>(
    fields: readonly Field[],
    headers: string[],
    labels: Partial<Record<Field, string>> = {},
): Partial<Record<Field, string>> {
    const headerByKey = new Map(
        headers.map((header) => [normalizeHeader(header), header]),
    )
    const taken = new Set<string>()
    const mapping: Partial<Record<Field, string>> = {}
    for (const field of fields) {
        const header = [labels[field], ...(FIELD_ALIASES[field] ?? []), field]
            .filter((alias): alias is string => !!alias)
            .map((alias) => headerByKey.get(normalizeHeader(alias)))
            .find((candidate) => candidate && !taken.has(candidate))
        if (header) {
            mapping[field] = header
            taken.add(header)
        }
    }
    return mapping
}

export function tableFromJson(value: unknown): ImportTable {
    const records = firstRecordList(value)
    if (!records) throw new Error('JSON file holds no list of objects.')
    const rows = records.map((record) => flattenRecord(record))
    const headers = [...new Set(rows.flatMap(Object.keys))].filter(
        (key) => !(PASSTHROUGH_KEYS as readonly string[]).includes(key),
    )
    return { headers, rows }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

function firstRecordList(value: unknown): Record<string, unknown>[] | null {
    if (Array.isArray(value)) {
        return value.length > 0 && value.every(isRecord) ? value : null
    }
    if (!isRecord(value)) return null
    for (const nested of Object.values(value)) {
        const list = firstRecordList(nested)
        if (list) return list
    }
    return null
}

function flattenRecord(
    record: Record<string, unknown>,
    prefix = '',
    flat: Record<string, unknown> = {},
) {
    for (const [key, value] of Object.entries(record)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (isRecord(value)) flattenRecord(value, path, flat)
        else flat[path] = value
    }
    return flat
}

const TOP_LOGGER_SUB_GRADES = ['a', 'a+', 'b', 'b+', 'c', 'c+']

export function topLoggerGrade(value: string): string | null {
    if (!/^\d\.\d{1,2}$/.test(value)) return null
    const grade = Number(value)
    const main = Math.floor(grade)
    const sixth = Math.min(5, Math.round((grade - main) * 6))
    if (main >= 6) return `${main}${TOP_LOGGER_SUB_GRADES[sixth]}`
    if (sixth <= 1) return `${main}`
    if (sixth <= 3) return `${main}+`
    return main + 1 >= 6 ? '6a' : `${main + 1}`
}

export async function tableFromCsv(text: string): Promise<ImportTable> {
    const { parseCsv } = await import('@cj-tech-master/excelts/csv')
    const [headerRow = [], ...dataRows] = parseCsv(text, {
        delimiter: headerDelimiter(text),
        skipEmptyLines: 'greedy',
        columnMismatch: { less: 'pad', more: 'truncate' },
    })
    return rowsToTable(headerRow, dataRows)
}

export async function tableFromXlsx(buffer: ArrayBuffer): Promise<ImportTable> {
    const { Workbook } = await import('@cj-tech-master/excelts')
    const workbook = new Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet) return { headers: [], rows: [] }
    const width = sheet.columnCount
    const cells: unknown[][] = []
    sheet.eachRow((row) => {
        cells.push(
            Array.from({ length: width }, (_, index) =>
                xlsxCellValue(row.getCell(index + 1)),
            ),
        )
    })
    const [headerRow = [], ...dataRows] = cells
    return rowsToTable(headerRow.map(String), dataRows)
}

function headerDelimiter(text: string) {
    const header = text.split('\n', 1)[0] ?? ''
    const count = (delimiter: string) => header.split(delimiter).length
    return [',', ';', '\t'].reduce((best, delimiter) =>
        count(delimiter) > count(best) ? delimiter : best,
    )
}

interface XlsxCell {
    value: unknown
    text?: string
    fill?: { type?: string; fgColor?: { argb?: string } }
}

function xlsxCellValue(cell: XlsxCell): unknown {
    const { value } = cell
    if (value === null || value === undefined || value === '') {
        const argb =
            cell.fill?.type === 'pattern' ? cell.fill.fgColor?.argb : ''
        return argb ? normalizeHexColor(argb.slice(-6)) : ''
    }
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'object') return cell.text ?? ''
    return value
}

function rowsToTable(headerRow: unknown[], dataRows: unknown[][]): ImportTable {
    const headers = headerRow.map(
        (header, index) => String(header ?? '').trim() || `#${index + 1}`,
    )
    return {
        headers,
        rows: dataRows
            .filter((row) => row.some((value) => value !== ''))
            .map((row) =>
                Object.fromEntries(
                    headers.map((header, index) => [header, row[index] ?? '']),
                ),
            ),
    }
}

const textOf = (row: Record<string, unknown>, header: string | undefined) => {
    const value = header === undefined ? undefined : row[header]
    return value === undefined || value === null
        ? undefined
        : String(value).trim()
}

export interface RouteImportContext {
    typeByLabel: Map<string, string>
    gradeSystemFor: (type: string | null | undefined) => string
    locale: string
}

export function toImportedRoute(
    row: Record<string, unknown>,
    mapping: RouteImportMapping,
    context: RouteImportContext,
): ImportedRoute {
    const pick = (field: RouteImportField) => {
        const header = mapping[field]
        return header === undefined ? undefined : row[header]
    }
    const text = (field: RouteImportField) => textOf(row, mapping[field])

    const typeText = text('type')
    const type = typeText
        ? (context.typeByLabel.get(typeText.toLowerCase()) ?? null)
        : null
    const rawGrade = text('grade')
    const mappedSystem = text('grade_system')?.toLowerCase()
    const convertedGrade =
        rawGrade &&
        gradeIndex(mappedSystem || context.gradeSystemFor(type), rawGrade) ===
            null
            ? topLoggerGrade(rawGrade)
            : null
    const grade = convertedGrade ?? rawGrade
    const convertedSystem = type === 'Boulder' ? 'font' : 'french'
    const color = text('color')
    const anchor = text('anchor_point')
    const creator = pick('creator')
    const passthrough = Object.fromEntries(
        PASSTHROUGH_KEYS.filter((key) => key in row).map((key) => [
            key,
            row[key],
        ]),
    )

    return {
        ...passthrough,
        source_id: text('source_id') || undefined,
        name: text('name') ?? '',
        type,
        grade,
        grade_system: grade
            ? mappedSystem ||
              (convertedGrade ? convertedSystem : context.gradeSystemFor(type))
            : undefined,
        location: text('location'),
        wall: text('wall'),
        anchor_point: anchor ? anchor.replace(',', '.') : undefined,
        color:
            color && /^#?[0-9a-f]{6}/i.test(color)
                ? normalizeHexColor(color)
                : null,
        creator: Array.isArray(creator) ? creator : text('creator'),
        screw_date: parseImportDate(pick('screw_date'), context.locale),
        comment: text('comment') ?? '',
        archived: parseImportFlag(pick('archived')),
    }
}

export function toImportedReview(
    row: Record<string, unknown>,
    mapping: ReviewImportMapping,
    locale: string,
): ImportedReview {
    const text = (field: ReviewImportField) => textOf(row, mapping[field])
    const grade = text('grade')
    return {
        routeKey: text('route') ?? '',
        routeName: text('route_name') ?? '',
        location: text('location') ?? '',
        rating: parseImportRating(text('rating')),
        grade: grade || undefined,
        grade_system:
            (grade && text('grade_system')?.toLowerCase()) || undefined,
        comment: text('comment') ?? '',
        created: parseImportDateTime(row[mapping.created ?? ''], locale),
    }
}

export function parseImportRating(value: string | undefined): number | null {
    const [points, scale] = (value ?? '')
        .split('/')
        .map((part) => Number(part.replace(',', '.').trim()))
    const rating = scale ? (points! / scale) * 5 : points
    return value?.trim() && Number.isFinite(rating)
        ? Math.min(5, Math.max(1, rating!))
        : null
}

export interface MatchableRoute {
    id: string
    name: string
    location: string
    date: string
}

export function matchReviewRoute(
    review: Pick<
        ImportedReview,
        'routeKey' | 'routeName' | 'location' | 'created'
    >,
    routes: MatchableRoute[],
    sourceIds: Map<string, string>,
): string | null {
    const key = review.routeKey
    const imported = key ? sourceIds.get(key) : undefined
    if (imported) return imported
    if (key && routes.some((route) => route.id === key)) return key

    const name = (review.routeName || key).toLowerCase()
    const location = review.location.toLowerCase()
    if (!name) return null
    const candidates = routes
        .filter(
            (route) =>
                route.name.trim().toLowerCase() === name &&
                (!location || route.location.toLowerCase() === location),
        )
        .sort((left, right) => right.date.localeCompare(left.date))
    const reviewDay = review.created
        ? localDateYYYYMMDD(new Date(review.created))
        : undefined
    const setBeforeReview = candidates.find(
        (route) => !reviewDay || route.date.slice(0, 10) <= reviewDay,
    )
    return (setBeforeReview ?? candidates[0])?.id ?? null
}

export function parseImportDateTime(
    value: unknown,
    locale: string,
): string | null {
    if (value instanceof Date) return value.toISOString()
    const raw = String(value ?? '').trim()
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(raw)) {
        const parsed = new Date(raw.replace(' ', 'T'))
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    }
    const [datePart = '', timePart = '0:00'] = raw.split(/[ T,]+/)
    const day = parseImportDate(datePart, locale)
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timePart)
    if (!day || !time) return null
    const [year, month, date] = day.split('-').map(Number)
    return new Date(
        year!,
        month! - 1,
        date!,
        Number(time[1]),
        Number(time[2]),
        Number(time[3] ?? 0),
    ).toISOString()
}

export function parseImportDate(value: unknown, locale: string): string | null {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const raw = String(value ?? '').trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
    const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw)
    if (!match) return null
    const [, first, second, year] = match
    const monthFirst = raw.includes('/') && locale.startsWith('en')
    const [day, month] = monthFirst ? [second!, first!] : [first!, second!]
    if (Number(month) > 12 || Number(day) > 31) return null
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseImportFlag(value: unknown): boolean {
    if (typeof value === 'boolean') return value
    return ['true', '1', 'yes', 'x'].includes(
        String(value ?? '')
            .trim()
            .toLowerCase(),
    )
}
