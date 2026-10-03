import { INVENTORY_INSTRUCTIONS_KEY, INVENTORY_STORAGE_KEY } from './inventory'
import { TICKS_DB } from './tickOutbox'
import { RECENT_GYMS_KEY } from './recentGyms'

export const AUTH_COOKIE = 'pb_auth'
export const SESSION_ONLY_AUTH_COOKIE = 'pb_auth_session'
export const THEME_MODE_COOKIE = 'theme-mode'
export const SIDEBAR_OPEN_COOKIE = 'sidebar-open'
export const GYM_COOKIE = 'gym'
export const EXPORT_COLUMNS_KEY = 'gripello.export-columns'
export const COMPETITION_SCORES_KEY = 'gripello:competition-scores'

export type ClientStorageKind = 'cookie' | 'localStorage' | 'indexedDB'

export interface ClientStorageEntry {
    name: string
    kind: ClientStorageKind
    purpose: string
    duration: string
}

export const CLIENT_STORAGE: ClientStorageEntry[] = [
    { name: AUTH_COOKIE, kind: 'cookie', purpose: 'auth', duration: 'session' },
    {
        name: SESSION_ONLY_AUTH_COOKIE,
        kind: 'cookie',
        purpose: 'auth',
        duration: 'session',
    },
    {
        name: THEME_MODE_COOKIE,
        kind: 'cookie',
        purpose: 'colorScheme',
        duration: 'oneYear',
    },
    {
        name: SIDEBAR_OPEN_COOKIE,
        kind: 'cookie',
        purpose: 'sidebar',
        duration: 'oneYear',
    },
    {
        name: GYM_COOKIE,
        kind: 'cookie',
        purpose: 'gym',
        duration: 'oneYear',
    },
    {
        name: RECENT_GYMS_KEY,
        kind: 'localStorage',
        purpose: 'recentGyms',
        duration: 'persistent',
    },
    {
        name: EXPORT_COLUMNS_KEY,
        kind: 'localStorage',
        purpose: 'exportColumns',
        duration: 'persistent',
    },
    {
        name: INVENTORY_STORAGE_KEY,
        kind: 'localStorage',
        purpose: 'inventorySession',
        duration: 'persistent',
    },
    {
        name: INVENTORY_INSTRUCTIONS_KEY,
        kind: 'localStorage',
        purpose: 'inventoryInstructions',
        duration: 'persistent',
    },
    {
        name: COMPETITION_SCORES_KEY,
        kind: 'localStorage',
        purpose: 'offlineScores',
        duration: 'persistent',
    },
    {
        name: TICKS_DB,
        kind: 'indexedDB',
        purpose: 'offlineLogbook',
        duration: 'persistent',
    },
]
