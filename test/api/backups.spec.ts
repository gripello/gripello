import { beforeEach, describe, expect, it } from 'vitest'
import {
    backupDownloadUrl,
    deleteBackup,
    listBackups,
    runBackup,
    saveBackupSettings,
} from '~/api/backups'
import { mockApi } from './apiMock'

let api: ReturnType<typeof mockApi>

beforeEach(() => {
    api = mockApi()
})

describe('backups', () => {
    it('lists, runs, deletes and saves the schedule', async () => {
        api.respond({ enabled: true, items: [] })
        expect(await listBackups()).toEqual({ enabled: true, items: [] })
        expect(api.request().url).toBe('/api/platform/backups')
        await runBackup()
        expect(api.request()).toMatchObject({ method: 'POST' })
        await deleteBackup('gripello-20261003-020000.tar')
        expect(api.request()).toMatchObject({
            url: '/api/platform/backups/gripello-20261003-020000.tar',
            method: 'DELETE',
        })
        await saveBackupSettings({ keep: 3, include_storage: false })
        expect(api.request()).toMatchObject({
            url: '/api/platform/backups/settings',
            method: 'PUT',
            body: { keep: 3, include_storage: false },
        })
    })

    it('links the download through the api prefix', () => {
        expect(backupDownloadUrl('gripello-20261003-020000.tar')).toBe(
            '/api/platform/backups/gripello-20261003-020000.tar',
        )
    })
})
