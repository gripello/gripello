import { createError, readBody, getRequestURL, type H3Event } from 'h3'
import type PocketBase from 'pocketbase'
import type { RouteRecord } from '../../types/models'
import {
    formatDate,
    locationName,
    wallName,
    normalizeCreators,
} from '#shared/utils/formatting'
import { formatGrade } from '#shared/utils/grades'

interface ExportBody {
    ids?: unknown[]
    gym?: unknown
    locale?: unknown
    labels?: Record<string, unknown>
    typeLabels?: Record<string, unknown>
    columns?: unknown[]
    show?: Record<string, unknown>
}

interface FetchByIdsOptions {
    collection: string
    ids: string[]
    field: string
    requestKey: string
    expand?: string
    gym: string
}

export interface ExportColumn {
    key: string
    header: string
    value?: (route: RouteRecord, locale?: string) => string | number
}

async function readExportBody(event: H3Event): Promise<ExportBody | null> {
    if (event.context._exportBody === undefined) {
        try {
            event.context._exportBody = (await readBody(event)) ?? null
        } catch {
            event.context._exportBody = null
        }
    }
    return event.context._exportBody
}

export async function resolveRouteIds(event: H3Event): Promise<string[]> {
    const body = await readExportBody(event)
    if (body && Array.isArray(body.ids)) {
        return body.ids
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean)
    }

    return []
}

export function buildIdFilter(pb: PocketBase, ids: string[], field: string) {
    if (ids.length === 0) {
        return ''
    }
    return ids.map((id) => pb.filter(`${field} = {:id}`, { id })).join(' || ')
}

export function chunk<T>(source: T[], size: number): T[][] {
    const output: T[][] = []
    for (let index = 0; index < source.length; index += size) {
        output.push(source.slice(index, index + size))
    }
    return output
}

export async function fetchRecordsByIds<T = RouteRecord>(
    pb: PocketBase,
    options: FetchByIdsOptions,
): Promise<T[]> {
    const { collection, ids, field, requestKey, expand, gym } = options
    if (ids.length === 0) {
        return []
    }

    const chunks = chunk(ids, 25)
    const requests = chunks.map((chunkIds, index) => {
        return pb.collection(collection).getFullList<T>({
            filter: `(${buildIdFilter(pb, chunkIds, field)}) && ${pb.filter('gym = {:gym}', { gym })}`,
            expand,
            requestKey: `${requestKey}-${index}`,
        })
    })

    const results = await Promise.all(requests)
    return results.flat()
}

export function resolveApplicationUrl(event: H3Event) {
    return getRequestURL(event, { xForwardedProto: true }).origin.replace(
        /\/+$/,
        '',
    )
}

export async function resolveExportGymId(event: H3Event) {
    const gym = (await readExportBody(event))?.gym
    if (typeof gym !== 'string' || !gym.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: 'No gym provided.',
        })
    }
    return gym.trim()
}

export async function resolveExportLocale(event: H3Event): Promise<string> {
    const body = await readExportBody(event)
    try {
        return (
            Intl.DateTimeFormat.supportedLocalesOf([String(body?.locale)])[0] ??
            'en'
        )
    } catch {
        return 'en'
    }
}

export async function resolveExportLabel(
    event: H3Event,
    key: string,
    fallback: string,
) {
    const label = (await readExportBody(event))?.labels?.[key]
    return typeof label === 'string' && label.trim() ? label.trim() : fallback
}

export async function resolveExportShow(event: H3Event) {
    const show = (await readExportBody(event))?.show
    return {
        creators: show?.creators !== false,
        date: show?.date !== false,
        logo: show?.logo !== false,
    }
}

export const TAG_QR_ERROR_CORRECTION = 'Q'

export const ROUTE_EXPORT_COLUMNS: ExportColumn[] = [
    { key: 'color', header: 'Color' },
    { key: 'name', header: 'Name', value: (r) => r.name ?? '' },
    {
        key: 'difficulty',
        header: 'Grade',
        value: (r) => formatGrade(r),
    },
    {
        key: 'anchor_point',
        header: 'Anchor',
        value: (r) => r.anchor_point ?? '',
    },
    {
        key: 'comment',
        header: 'Comment',
        value: (r) => r.comment ?? '',
    },
    {
        key: 'creator',
        header: 'Setters',
        value: (r) => normalizeCreators(r.creator).join(', '),
    },
    {
        key: 'location',
        header: 'Location',
        value: (r) => locationName(r),
    },
    { key: 'wall', header: 'Wall', value: (r) => wallName(r) },
    { key: 'type', header: 'Type', value: (r) => r.type ?? '' },
    {
        key: 'screw_date',
        header: 'Set on',
        value: (r, locale) => formatDate(r.screw_date, { locale }),
    },
    { key: 'qr', header: 'QR' },
]

const DEFAULT_EXPORT_COLUMNS = ROUTE_EXPORT_COLUMNS.filter(
    (column) => column.key !== 'qr',
)

export async function resolveExportColumns(
    event: H3Event,
): Promise<ExportColumn[]> {
    const body = await readExportBody(event)
    const columnByKey = new Map(
        ROUTE_EXPORT_COLUMNS.map((column) => [column.key, column]),
    )

    const requested = Array.isArray(body?.columns)
        ? Array.from(
              new Set(
                  body.columns.filter(
                      (key): key is string =>
                          typeof key === 'string' && columnByKey.has(key),
                  ),
              ),
          )
        : []

    const chosen = requested.length
        ? requested.map((key) => columnByKey.get(key)!)
        : DEFAULT_EXPORT_COLUMNS
    const labels: Record<string, unknown> =
        body?.labels && typeof body.labels === 'object' ? body.labels : {}
    const typeLabels: Record<string, unknown> =
        body?.typeLabels && typeof body.typeLabels === 'object'
            ? body.typeLabels
            : {}
    const locale = await resolveExportLocale(event)
    const translatedType = (route: RouteRecord) => {
        const typeLabel = typeLabels[route.type ?? '']
        return typeof typeLabel === 'string' && typeLabel.trim()
            ? typeLabel.trim()
            : (route.type ?? '')
    }

    return chosen.map((column) => {
        const label = labels[column.key]
        const columnValue =
            column.key === 'type' ? translatedType : column.value
        return {
            ...column,
            value:
                columnValue &&
                ((route: RouteRecord) => columnValue(route, locale)),
            header:
                typeof label === 'string' && label.trim()
                    ? label.trim()
                    : column.header,
        }
    })
}

export function attachmentHeader(filename: string) {
    const ascii =
        filename
            .normalize('NFKD')
            .replace(/[^\x20-\x7e]/g, '')
            .replace(/[^\w.-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'export'
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
