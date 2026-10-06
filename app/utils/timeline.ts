import { parseDate } from '#shared/utils/formatting'
import { isSend } from '#shared/utils/logbook'
import { localDay, tickDay, type TickType } from '#shared/utils/ticks'
import { ALL_GYMS } from '~/utils/logbookGyms'
import type { RouteRecord } from '~/types/models'

export const TIMELINE_KINDS = ['all', 'send', 'review', 'beta'] as const
export type TimelineFilter = (typeof TIMELINE_KINDS)[number]

export interface ContributionRoute {
    id: string
    name: string
    color: string
    grade: string
    gym: string
}

export interface Contribution {
    id: string
    created: string
    rating?: number
    comment?: string
    url?: string
    file?: string
    route: ContributionRoute | null
}

export interface TimelineTick {
    id: string
    date: string
    created?: string
    type: TickType
    route?: string | null
    route_name?: string
    expand?: { route?: Partial<Pick<RouteRecord, 'name' | 'color' | 'gym'>> }
}

export interface TimelineEntry {
    kind: Exclude<TimelineFilter, 'all'> | 'attempt'
    id: string
    at: string
    routeId: string
    routeName: string
    color?: string | null
    tickType?: TickType
    rating?: number
    comment?: string
    url?: string
}

const dayOf = (timestamp: string) => {
    const parsed = parseDate(timestamp)
    return parsed ? localDay(parsed) : ''
}

const timeOf = (timestamp: string) => parseDate(timestamp)?.getTime() ?? 0

const contributionEntry =
    (kind: 'review' | 'beta') =>
    (item: Contribution): TimelineEntry & { day: string; gym?: string } => ({
        kind,
        id: item.id,
        at: item.created,
        day: dayOf(item.created),
        gym: item.route?.gym,
        routeId: item.route?.id ?? '',
        routeName: item.route?.name ?? '',
        color: item.route?.color,
        rating: item.rating,
        comment: item.comment,
        url: item.url || undefined,
    })

export function timelineDays(
    ticks: TimelineTick[],
    reviews: Contribution[],
    betas: Contribution[],
    filter: TimelineFilter,
    gymId: string = ALL_GYMS,
): { day: string; entries: TimelineEntry[] }[] {
    const entries = [
        ...ticks.map((tick) => ({
            kind: isSend(tick) ? ('send' as const) : ('attempt' as const),
            id: tick.id,
            at:
                tick.created && dayOf(tick.created) === tickDay(tick.date)
                    ? tick.created
                    : tick.date,
            day: tickDay(tick.date),
            gym: tick.expand?.route?.gym,
            routeId: tick.route ?? '',
            routeName: tick.expand?.route?.name ?? tick.route_name ?? '',
            color: tick.expand?.route?.color,
            tickType: tick.type,
        })),
        ...reviews.map(contributionEntry('review')),
        ...betas.map(contributionEntry('beta')),
    ].filter(
        (entry) =>
            (filter === 'all' || entry.kind === filter) &&
            (gymId === ALL_GYMS || entry.gym === gymId),
    )
    const days = new Map<string, TimelineEntry[]>()
    for (const { day, gym: _gym, ...entry } of entries)
        days.set(day, [...(days.get(day) ?? []), entry])
    return [...days]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, dayEntries]) => ({
            day,
            entries: dayEntries.sort((a, b) => timeOf(b.at) - timeOf(a.at)),
        }))
}
