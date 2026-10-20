import { INVENTORY_STORAGE_KEY } from './inventory'
import { TICKS_DB } from './tickOutbox'
import { RECENT_GYMS_KEY } from './recentGyms'
import { PUSH_DECLINED_KEY } from './push'
import { AUTH_COOKIE, SESSION_ONLY_AUTH_COOKIE } from '#shared/utils/authCookie'
import {
    GYM_COOKIE,
    SIDEBAR_OPEN_COOKIE,
    THEME_MODE_COOKIE,
} from '#shared/utils/cookies'

export { AUTH_COOKIE, SESSION_ONLY_AUTH_COOKIE } from '#shared/utils/authCookie'
export {
    GYM_COOKIE,
    SIDEBAR_OPEN_COOKIE,
    THEME_MODE_COOKIE,
} from '#shared/utils/cookies'

export const EXPORT_COLUMNS_KEY = 'gripello.export-columns'
export const EXPORT_TAG_TEMPLATE_KEY = 'gripello.export-tag-template'
export const COMPETITION_SCORES_KEY = 'gripello:competition-scores'
export const MAP_ROUTE_TYPE_KEY = 'map-route-type'
export const MAP_CONSENT_KEY = 'gripello-map-consent'
export const MODERATION_SEEN_KEY = 'gripello.moderation-seen'
export const SERVICE_WORKER_CACHES = 'gripello-*'

export type ClientStorageKind =
    'cookie' | 'localStorage' | 'indexedDB' | 'cacheStorage'

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
        name: MODERATION_SEEN_KEY,
        kind: 'localStorage',
        purpose: 'moderationSeen',
        duration: 'persistent',
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
        name: EXPORT_TAG_TEMPLATE_KEY,
        kind: 'localStorage',
        purpose: 'exportTagTemplate',
        duration: 'persistent',
    },
    {
        name: INVENTORY_STORAGE_KEY,
        kind: 'localStorage',
        purpose: 'inventorySession',
        duration: 'persistent',
    },
    {
        name: COMPETITION_SCORES_KEY,
        kind: 'localStorage',
        purpose: 'offlineScores',
        duration: 'persistent',
    },
    {
        name: PUSH_DECLINED_KEY,
        kind: 'localStorage',
        purpose: 'pushDeclined',
        duration: 'persistent',
    },
    {
        name: MAP_ROUTE_TYPE_KEY,
        kind: 'localStorage',
        purpose: 'mapRouteType',
        duration: 'persistent',
    },
    {
        name: MAP_CONSENT_KEY,
        kind: 'localStorage',
        purpose: 'mapConsent',
        duration: 'persistent',
    },
    {
        name: TICKS_DB,
        kind: 'indexedDB',
        purpose: 'offlineLogbook',
        duration: 'persistent',
    },
    {
        name: SERVICE_WORKER_CACHES,
        kind: 'cacheStorage',
        purpose: 'offlinePages',
        duration: 'untilUpdate',
    },
]
