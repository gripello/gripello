import type { Page } from '@playwright/test'
import type { Api } from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const PASSWORD = 'E2ePassw0rd!'

type BackupList = {
    items: { name: string }[]
    running: boolean
    settings: { keep: number; include_storage: boolean; hour: number }
}

async function confirmWithPassword(page: Page, field: string) {
    await page.getByTestId(field).fill(PASSWORD)
    await page.getByTestId('confirm-dialog-confirm').click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()
}

async function reauthenticated(api: Api) {
    await api.post('/me/reauthenticate', { password: PASSWORD })
    return api
}

test('the overview shows traffic numbers and the busiest endpoints', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform')
    const requests = page
        .getByTestId('platform-kpi-requests')
        .getByTestId('stats-card-value')
    await expect(requests).toHaveText(/\d/)
    await expect(page.getByTestId('platform-traffic-chart')).toBeVisible()
    await expect(page.getByTestId('platform-endpoints')).toBeVisible()

    const reload = page.waitForResponse(
        (response) =>
            response.url().includes('/api/platform/traffic?range=7d') &&
            response.ok(),
    )
    await page.getByTestId('platform-traffic-range-7d').click()
    await reload
    await expect(requests).toHaveText(/\d/)
    await expect(page.getByTestId('platform-system-database')).toBeVisible()
    await expect(
        page
            .getByTestId('platform-servers')
            .locator('[data-testid^="platform-server-"]'),
    ).not.toHaveCount(0)
})

test('server logs filter by level, search and open a line', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/logs')
    const list = page.getByTestId('platform-logs-list')
    await expect(list.locator('li').first()).toBeVisible()
    await expect(page.getByTestId('platform-logs-replicas')).toBeVisible()

    await page.getByTestId('platform-logs-count-error').click()
    await expect(page.getByTestId('platform-logs-count-error')).toHaveAttribute(
        'aria-pressed',
        'true',
    )
    await page.getByTestId('platform-logs-filter-debug').click()

    await page.getByTestId('platform-logs-search').fill('listening')
    const line = list.locator('li').first()
    await expect(line).toContainText('listening')
    await line.getByRole('button').first().click()
    await expect(line.getByTestId('platform-logs-copy')).toBeVisible()

    await page.getByTestId('platform-logs-live').click()
    await expect(page.getByTestId('platform-logs-live')).toContainText(
        /paused|pausiert/i,
    )
})

test('platform admins change the server log level', async ({
    platformPage: page,
    api,
}) => {
    await gotoSettled(page, '/platform/logs')
    const levels = page.getByTestId('platform-logs-runtime-level')
    try {
        await levels.getByRole('radio').nth(2).click()
        await expect
            .poll(
                async () =>
                    (await api.get<{ level: string }>('/platform/logs')).level,
            )
            .toBe('WARN')
    } finally {
        await api.put('/platform/logs/level', { level: 'info' })
    }
})

test('backups run, keep their schedule and can be deleted', async ({
    platformPage: page,
    api,
}) => {
    const before = await api.get<BackupList>('/platform/backups')
    await gotoSettled(page, '/platform/backups')
    await expect(page.getByTestId('platform-backups-status')).toBeVisible()

    await page.getByTestId('platform-backups-run').click()
    let created = ''
    await expect
        .poll(
            async () => {
                const list = await api.get<BackupList>('/platform/backups')
                created =
                    list.items.find(
                        (item) =>
                            !before.items.some((old) => old.name === item.name),
                    )?.name ?? ''
                return !list.running && !!created
            },
            { timeout: 60_000 },
        )
        .toBe(true)
    await page.reload()
    const row = page.getByTestId(`platform-backup-${created}`)
    await expect(row).toBeVisible()

    try {
        await page.getByTestId('platform-backups-keep').fill('5')
        await page.getByTestId('platform-backups-keep').press('Tab')
        await page.getByTestId('platform-backups-save').click()
        await confirmWithPassword(page, 'platform-backups-admin-password')
        await expect
            .poll(
                async () =>
                    (await api.get<BackupList>('/platform/backups')).settings
                        .keep,
            )
            .toBe(5)

        await page.getByTestId(`platform-backup-delete-${created}`).click()
        await confirmWithPassword(page, 'platform-backups-admin-password')
        await expect(row).toHaveCount(0)
        created = ''
    } finally {
        const admin = await reauthenticated(api)
        await admin.put('/platform/backups/settings', before.settings)
        if (created) await admin.delete(`/platform/backups/${created}`)
    }
})

test('platform settings show the status and run the mail check', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/platform/settings')
    await expect(
        page.getByTestId('platform-settings-status-registration'),
    ).toBeVisible()
    await page.getByTestId('platform-settings-status-mail').click()
    await expect(page).toHaveURL(/section=mail/)

    await page.getByTestId('platform-mail-test').click()
    for (const stage of ['connect', 'encrypt', 'sign_in', 'deliver'])
        await expect(
            page.getByTestId(`platform-mail-check-${stage}`),
        ).toHaveAttribute('data-state', 'ok')
})

test('a sign-in provider becomes configured once its keys are saved', async ({
    platformPage: page,
    api,
}) => {
    await gotoSettled(page, '/platform/settings?section=signIn')
    const provider = page.getByTestId('platform-oauth-oidc')
    await expect(provider).toHaveAttribute('data-status', 'missing')
    try {
        await page.getByTestId('platform-oauth-oidc-toggle').click()
        await provider
            .getByRole('textbox', { name: /issuer/i })
            .fill('https://auth.example.com/realms/e2e')
        await page
            .getByTestId('platform-oauth-oidc-client-id')
            .fill('e2e-client')
        await provider.locator('input[type="password"]').fill('e2e-secret')
        await page.getByTestId('platform-oauth-oidc-save').click()
        await confirmWithPassword(page, 'platform-oauth-admin-password')
        await expect(provider).toHaveAttribute('data-status', 'configured')
    } finally {
        const admin = await reauthenticated(api)
        await admin.put('/platform/oauth2/oidc', {
            enabled: false,
            client_id: '',
            client_secret: '',
            display_name: '',
            issuer_url: '',
            tenant: '',
            team_id: '',
            key_id: '',
            private_key: '',
        })
    }
})
