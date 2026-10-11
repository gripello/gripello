import { describe, expect, it } from 'vitest'
import { backupHourOptions, formatBytes, nextBackupRun } from '~/utils/backups'

describe('formatBytes', () => {
    it('picks a binary unit with one decimal above bytes', () => {
        expect(formatBytes(512, 'en')).toBe('512 byte')
        expect(formatBytes(1536, 'en')).toBe('1.5 kB')
        expect(formatBytes(5 * 1024 ** 3, 'en')).toBe('5 GB')
    })
})

describe('backupHourOptions', () => {
    it('labels each UTC hour in the viewer time zone', () => {
        const options = backupHourOptions('de', 'Europe/Berlin')
        expect(options).toHaveLength(24)
        expect(options[2]).toEqual({ value: 2, label: '03:30' })
        expect(backupHourOptions('de', 'UTC')[23]?.label).toBe('23:30')
    })
})

describe('nextBackupRun', () => {
    it('picks today when the run is still ahead, else tomorrow', () => {
        const morning = new Date('2026-10-11T01:00:00Z')
        expect(nextBackupRun(2, morning).toISOString()).toBe(
            '2026-10-11T02:30:00.000Z',
        )
        expect(nextBackupRun(0, morning).toISOString()).toBe(
            '2026-10-12T00:30:00.000Z',
        )
    })
})
