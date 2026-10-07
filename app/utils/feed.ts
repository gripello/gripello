import type { BetaVideoRecord, RouteRecord } from '~/types/models'
import type { FeedTick } from '~/utils/friends'
import { localDay, tickDay } from '#shared/utils/ticks'
import { formatDate } from '#shared/utils/formatting'

export type FeedRoute = RouteRecord & { created: string }
export type FeedBeta = BetaVideoRecord & {
    created: string
    expand?: { route?: RouteRecord }
}

export interface ActivityDay {
    day: string
    ticks: FeedTick[]
}

const stamp = (tick: FeedTick) => tick.created ?? tick.date ?? ''

export function activityDays(ticks: FeedTick[]): ActivityDay[] {
    const days = new Map<string, FeedTick[]>()
    for (const tick of ticks) {
        const day = tickDay(tick.date)
        days.set(day, [...(days.get(day) ?? []), tick])
    }
    return [...days]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, dayTicks]) => ({
            day,
            ticks: dayTicks.sort((a, b) => stamp(b).localeCompare(stamp(a))),
        }))
}

export function activityDayLabel(
    day: string,
    t: (key: string) => string,
    locale: string,
    now: Date | null = new Date(),
): string {
    if (now && day === localDay(now)) return t('feed.today')
    if (now && day === localDay(new Date(now.getTime() - 86_400_000)))
        return t('feed.yesterday')
    return formatDate(day, {
        locale,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    })
}
