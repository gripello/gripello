import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'

// A guarded call on this page's own session: 403 reauth_required unless it was just confirmed.
async function sessionConfirmed(page: Page) {
    const response = await page.request.delete('/api/gyms/no-such-gym', {
        headers: await authHeader(page),
    })
    const body = await response.text()
    return !(response.status() === 403 && body.includes('reauth_required'))
}

// Catches: the app's return from the provider (a page with ?oauth2Reauth=) crashing or confirming a bad ticket.
test('a provider ticket that comes back to a page is redeemed safely', async ({
    platformPage: page,
}) => {
    for (const query of [
        'oauth2Reauth=bogus-ticket',
        'oauth2ReauthError=failed',
    ]) {
        await test.step(query, async () => {
            await gotoSettled(page, `/platform/gyms?${query}`)
            await expect(
                page.getByTestId('global-snackbar-message').last(),
            ).toHaveText('Confirmation failed')
            await expect(page).not.toHaveURL(/oauth2Reauth/)
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
            expect(await sessionConfirmed(page)).toBe(false)
        })
    }
})

// Catches: the popup page crashing or reporting success for a ticket the server refused.
test('the popup page reports a refused ticket', async ({
    platformPage: page,
}) => {
    await gotoSettled(page, '/auth/reauth?oauth2Reauth=bogus-ticket')
    await expect(page.getByTestId('reauth-page')).toHaveAttribute(
        'data-state',
        'failed',
    )
    await expect(page.getByTestId('reauth-page')).toContainText(
        'Confirmation failed',
    )
    expect(await sessionConfirmed(page)).toBe(false)
})
