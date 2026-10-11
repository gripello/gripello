import { describe, expect, it } from 'vitest'
import {
    filterLogs,
    logAttrsText,
    logHistogram,
    logLevelColor,
    logLevelCounts,
    logModule,
    logReplicas,
} from '~/utils/serverLogs'

describe('logAttrsText', () => {
    it('writes sorted key=value pairs and quotes values with spaces', () => {
        expect(logAttrsText({ path: '/api/x', error: 'no rows', ms: 12 })).toBe(
            'error="no rows" ms=12 path=/api/x',
        )
    })

    it('is empty without attributes', () => {
        expect(logAttrsText(undefined)).toBe('')
    })
})

describe('logLevelColor', () => {
    it('maps slog level names, including offsets like WARN+2', () => {
        expect(logLevelColor('ERROR')).toBe('error')
        expect(logLevelColor('WARN+2')).toBe('warning')
        expect(logLevelColor('DEBUG')).toBe('neutral')
        expect(logLevelColor('INFO')).toBe('info')
    })
})

describe('log filtering and summaries', () => {
    const now = Date.parse('2026-10-11T10:30:30Z')
    const lines = [
        {
            time: '2026-10-11T10:30:10Z',
            replica: 'gripello-2',
            level: 'ERROR',
            message: 'mail: sending failed',
            attrs: { host: 'smtp.ionos.com' },
        },
        {
            time: '2026-10-11T10:29:50Z',
            replica: 'gripello-1',
            level: 'WARN',
            message: 'climber search limited',
            attrs: { module: 'ratelimit' },
        },
        {
            time: '2026-10-11T10:29:40Z',
            replica: 'gripello-1',
            level: 'INFO',
            message: 'listening',
        },
        { time: '2026-10-11T09:00:00Z', level: 'DEBUG', message: 'old' },
    ]

    it('filters by minimum level and searches message and fields', () => {
        expect(filterLogs(lines, 'warn', '').map((l) => l.level)).toEqual([
            'ERROR',
            'WARN',
        ])
        expect(filterLogs(lines, 'debug', 'IONOS')).toHaveLength(1)
        const tenth = { ...lines[2]!, replica: 'gripello-10', message: 'x' }
        expect(
            filterLogs([...lines, tenth], 'debug', '', 'gripello-1').map(
                (l) => l.message,
            ),
        ).toEqual(['climber search limited', 'listening'])
        expect(filterLogs(lines, 'debug', 'gripello-1')).toHaveLength(0)
    })

    it('lists reporting servers with their status, then stopped ones from the lines', () => {
        expect(
            logReplicas(
                [...lines, { ...lines[0]!, replica: 'gripello-old' }],
                [
                    { name: 'gripello-1', online: true },
                    { name: 'gripello-3', online: false },
                ],
            ),
        ).toEqual([
            { name: 'gripello-1', lines: 2, status: 'online' },
            { name: 'gripello-3', lines: 0, status: 'offline' },
            { name: 'gripello-2', lines: 1, status: 'gone' },
            { name: 'gripello-old', lines: 1, status: 'gone' },
        ])
    })

    it('names the module from an attribute or the message prefix', () => {
        expect(lines.map(logModule)).toEqual(['mail', 'ratelimit', '', ''])
    })

    it('counts levels and buckets the last minutes', () => {
        expect(logLevelCounts(lines)).toEqual({
            debug: 1,
            info: 1,
            warn: 1,
            error: 1,
        })
        const histogram = logHistogram(lines, 30, now)
        expect(histogram).toHaveLength(30)
        expect(histogram[29]).toEqual({ info: 0, warn: 0, error: 1 })
        expect(histogram[28]).toEqual({ info: 1, warn: 1, error: 0 })
    })
})
