export function insightRate(
    count: number | null | undefined,
    base: number | null | undefined,
) {
    if (count == null || !base) return null
    return count / base
}

export function insightTrend(current: number, previous: number) {
    return previous ? (current - previous) / previous : null
}

export function insightDayLabel(day: string, locale: string) {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    })
}

// Below this many logs a halving is noise, not a gym going quiet.
const QUIET_MIN_PREVIOUS = 20

export function gymGoingQuiet(logs: number, previousLogs: number) {
    return previousLogs >= QUIET_MIN_PREVIOUS && logs < previousLogs / 2
}

export type InsightGymSort = 'logs' | 'drop'

export function sortInsightGyms<
    T extends { logs: number; previous_logs: number },
>(gyms: T[], sort: InsightGymSort) {
    const change = (gym: T) => insightTrend(gym.logs, gym.previous_logs) ?? 0
    return [...gyms].sort((a, b) =>
        sort === 'logs' ? b.logs - a.logs : change(a) - change(b),
    )
}

export function formatTrend(rate: number, locale: string) {
    return new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 0,
        signDisplay: 'exceptZero',
    }).format(rate)
}
