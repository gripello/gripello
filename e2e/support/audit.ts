import { expect, type Page } from '@playwright/test'
import type { AuditLogRecord } from '../../types/models'
import { listAudit, type AuditQuery } from './api'
import { apiOf } from './nav'
import { E2E_GYM_SLUG } from './seed'

export type AuditScope = 'platform' | 'own' | { gym: string }

export async function fetchAuditRows(
    page: Page,
    query: AuditQuery,
    scope: AuditScope = { gym: E2E_GYM_SLUG },
) {
    return listAudit(await apiOf(page), scope, query)
}

export async function fetchAuditRowsAnonymously(page: Page) {
    const response = await page.request.get(`/api/gyms/${E2E_GYM_SLUG}/audit`)
    return { status: response.status(), body: await response.json() }
}

export async function waitForAuditRow(
    page: Page,
    query: AuditQuery,
    scope?: AuditScope,
) {
    let rows: AuditLogRecord[] = []
    await expect
        .poll(
            async () =>
                (rows = await fetchAuditRows(page, query, scope)).length,
            { message: `audit row matching ${JSON.stringify(query)}` },
        )
        .toBeGreaterThan(0)
    return rows
}
