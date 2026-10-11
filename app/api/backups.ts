import { apiUrl, useApi } from './client'

export interface BackupArchive {
    name: string
    size: number
    created: string
}

export interface BackupSettings {
    keep: number
    include_storage: boolean
    hour: number
}

export interface BackupList {
    enabled: boolean
    running?: boolean
    items: BackupArchive[]
    settings?: BackupSettings
    last_run?: string | null
    last_error?: string
    pg_dump?: boolean
    dir?: string
    disk_free?: number
    disk_total?: number
}

export function listBackups() {
    return useApi()<BackupList>('/platform/backups')
}

export function runBackup() {
    return useApi()('/platform/backups', { method: 'POST' })
}

export function deleteBackup(name: string) {
    return useApi()(`/platform/backups/${encodeURIComponent(name)}`, {
        method: 'DELETE',
    })
}

export function saveBackupSettings(settings: BackupSettings) {
    return useApi()<BackupSettings>('/platform/backups/settings', {
        method: 'PUT',
        body: settings,
    })
}

// A plain link: the browser streams the archive with the session cookie after a fresh password confirmation.
export function backupDownloadUrl(name: string) {
    return apiUrl(`/platform/backups/${encodeURIComponent(name)}`)
}
