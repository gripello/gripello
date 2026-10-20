import type { TrafficEndpoint, TrafficTotals } from '~/api/platform'

export type EndpointSort = 'errors' | 'requests' | 'slowest'

export function errorRate(
    totals: Pick<TrafficTotals, 'requests' | 'server_errors'>,
) {
    return totals.requests ? totals.server_errors / totals.requests : 0
}

export function clientErrorRate(
    totals: Pick<TrafficTotals, 'requests' | 'client_errors'>,
) {
    return totals.requests ? totals.client_errors / totals.requests : 0
}

// Relative change, null when there is nothing to compare with.
export function relativeChange(current: number, previous: number) {
    return previous ? (current - previous) / previous : null
}

export function sortEndpoints(endpoints: TrafficEndpoint[], by: EndpointSort) {
    const key: Record<EndpointSort, (e: TrafficEndpoint) => number> = {
        errors: (e) => errorRate(e) * 1e6 + clientErrorRate(e),
        requests: (e) => e.requests,
        slowest: (e) => e.p95_ms * 1e6 + e.avg_ms,
    }
    return [...endpoints].sort((a, b) => key[by](b) - key[by](a))
}

export function errorRateColor(rate: number) {
    return rate >= 0.05 ? 'error' : rate >= 0.01 ? 'warning' : 'success'
}

export function formatMs(ms: number, locale?: string) {
    return ms >= 1000
        ? new Intl.NumberFormat(locale, {
              style: 'unit',
              unit: 'second',
              maximumFractionDigits: 1,
          }).format(ms / 1000)
        : new Intl.NumberFormat(locale, {
              style: 'unit',
              unit: 'millisecond',
              maximumFractionDigits: 0,
          }).format(ms)
}

export function formatUptime(
    started: string | undefined,
    locale?: string,
    now = Date.now(),
) {
    if (!started) return ''
    const minutes = Math.max(
        0,
        Math.floor((now - Date.parse(started)) / 60_000),
    )
    const unit = (value: number, unit: 'day' | 'hour' | 'minute') =>
        new Intl.NumberFormat(locale, {
            style: 'unit',
            unit,
            unitDisplay: 'narrow',
        }).format(value)
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    if (days) return `${unit(days, 'day')} ${unit(hours, 'hour')}`
    if (hours) return `${unit(hours, 'hour')} ${unit(minutes % 60, 'minute')}`
    return unit(minutes, 'minute')
}

// Shares of each sign-in method, largest first.
export function methodShares(methods: Record<string, number>) {
    const total = Object.values(methods).reduce((sum, n) => sum + n, 0)
    return Object.entries(methods)
        .map(([method, count]) => ({
            method,
            share: total ? count / total : 0,
        }))
        .sort((a, b) => b.share - a.share)
}

// Axis label of a series point: clock time for hourly steps or finer, otherwise the date.
export function trafficLabel(
    iso: string,
    stepSeconds: number,
    locale?: string,
) {
    const options: Intl.DateTimeFormatOptions =
        stepSeconds <= 3600
            ? { hour: '2-digit', minute: '2-digit' }
            : stepSeconds < 86400
              ? { weekday: 'short', hour: '2-digit' }
              : { day: 'numeric', month: 'short' }
    return new Intl.DateTimeFormat(locale, options).format(new Date(iso))
}
