import { describe, expect, it } from 'vitest'
import type { TrafficEndpoint } from '~/api/platform'
import {
    errorRate,
    errorRateColor,
    formatUptime,
    methodShares,
    relativeChange,
    sortEndpoints,
    trafficLabel,
} from '~/utils/platformTraffic'

const endpoint = (
    pattern: string,
    requests: number,
    server: number,
    p95: number,
): TrafficEndpoint => ({
    method: 'GET',
    pattern,
    requests,
    client_errors: 0,
    server_errors: server,
    p95_ms: p95,
    avg_ms: p95 / 2,
})

describe('platformTraffic', () => {
    const list = [
        endpoint('/a', 1000, 1, 50),
        endpoint('/b', 10, 5, 2500),
        endpoint('/c', 5000, 0, 10),
    ]

    it('sorts endpoints by server error rate, hits or latency', () => {
        expect(sortEndpoints(list, 'errors').map((e) => e.pattern)).toEqual([
            '/b',
            '/a',
            '/c',
        ])
        expect(sortEndpoints(list, 'requests').map((e) => e.pattern)).toEqual([
            '/c',
            '/a',
            '/b',
        ])
        expect(sortEndpoints(list, 'slowest')[0]?.pattern).toBe('/b')
    })

    it('rates errors and colours them by severity', () => {
        expect(errorRate({ requests: 0, server_errors: 0 })).toBe(0)
        expect(errorRateColor(errorRate(list[1]!))).toBe('error')
        expect(errorRateColor(0.02)).toBe('warning')
        expect(errorRateColor(0.001)).toBe('success')
    })

    it('compares with the previous window only when it had traffic', () => {
        expect(relativeChange(120, 100)).toBeCloseTo(0.2)
        expect(relativeChange(5, 0)).toBeNull()
    })

    it('formats uptime and sign-in method shares', () => {
        const now = Date.parse('2026-10-11T12:00:00Z')
        expect(formatUptime('2026-10-04T22:00:00Z', 'en', now)).toBe('6d 14h')
        expect(formatUptime('2026-10-11T11:15:00Z', 'en', now)).toBe('45m')
        expect(methodShares({ password: 3, passkey: 1 })).toEqual([
            { method: 'password', share: 0.75 },
            { method: 'passkey', share: 0.25 },
        ])
    })
    it('labels points by clock time or date depending on the step', () => {
        expect(trafficLabel('2026-10-11T09:05:00Z', 300, 'de').length).toBe(5)
        expect(trafficLabel('2026-10-11T00:00:00Z', 86400, 'en')).toMatch(/Oct/)
    })
})
