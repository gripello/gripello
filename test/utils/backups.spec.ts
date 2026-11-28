import { describe, expect, it } from 'vitest'
import {
    backupHourOptions,
    nextBackupRun,
    syncCleanForm,
    restoreCommand,
    timeZoneName,
} from '~/utils/backups'

describe('backupHourOptions', () => {
    it('labels each UTC hour in the viewer time zone', () => {
        const winter = new Date('2026-01-15T12:00:00Z')
        const options = backupHourOptions('de', 'Europe/Berlin', winter)
        expect(options).toHaveLength(24)
        expect(options[2]).toEqual({ value: 2, label: '03:30' })
        expect(backupHourOptions('de', 'UTC', winter)[23]?.label).toBe('23:30')
    })

    it('matches the next run during summer time', () => {
        const summer = new Date('2026-10-19T12:00:00Z')
        expect(backupHourOptions('de', 'Europe/Berlin', summer)[2]?.label).toBe(
            '04:30',
        )
    })
})

describe('timeZoneName', () => {
    it('names the zone the labels are in', () => {
        expect(
            timeZoneName(
                'en',
                'Europe/Berlin',
                new Date('2026-01-15T12:00:00Z'),
            ),
        ).toBe('GMT+1')
        expect(timeZoneName('en', 'UTC')).toBe('UTC')
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

describe('syncCleanForm', () => {
    const saved = { keep: 7, include_storage: true, hour: 2 }

    it('fills an untouched form with the newest settings', () => {
        const form = { ...saved }
        syncCleanForm(form, { ...saved, keep: 9 }, saved)
        expect(form.keep).toBe(9)
    })

    it('keeps edits while a poll brings the same settings again', () => {
        const form = { ...saved, hour: 5 }
        syncCleanForm(form, { ...saved }, saved)
        expect(form.hour).toBe(5)
    })

    it('takes the first settings that arrive', () => {
        const form = { keep: 0, include_storage: false, hour: 0 }
        syncCleanForm(form, saved, undefined)
        expect(form).toEqual(saved)
    })
})

describe('restoreCommand', () => {
    it('names the archive and leaves the confirmation to the CLI', () => {
        expect(
            restoreCommand('/srv/backups/', 'gripello-20260101-020000.tar'),
        ).toBe(
            'docker compose exec gripello gripello admin restore --file /srv/backups/gripello-20260101-020000.tar --storage',
        )
    })

    it('falls back to the default dir and a placeholder archive', () => {
        expect(restoreCommand(undefined)).toContain(
            '--file /data/backups/gripello-YYYYMMDD-HHMMSS.tar',
        )
    })
})
