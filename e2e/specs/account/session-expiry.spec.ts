import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import { Api, listOwnTicks, listRouteRatings } from '../../support/api'

async function signOutFromOtherDevice(page: Page) {
    const { token } = await (
        await apiOf(page)
    ).post<{ token: string }>('/me/sessions/sign-out-others')
    return new Api(token)
}

async function expectSignInPrompt(page: Page, routeId: string) {
    const notice = page.getByTestId('session-ended')
    await expect(notice).toBeVisible()
    await expect(
        page.locator(
            '[data-testid="global-snackbar-message"][data-color="error"]',
        ),
    ).toHaveCount(0)
    await notice.getByTestId('global-snackbar-action').click()
    await expect(page).toHaveURL(/\/auth\/login\?redirect=/)
    const redirect = new URL(page.url()).searchParams.get('redirect')
    expect(redirect).toContain(`id=${routeId}`)
}

test('a review typed while the session ended elsewhere is kept and asks to sign in again', async ({
    pageAs,
    createUser,
    adminApi,
    route,
}) => {
    const climber = await createUser('user', 'expiry-review')
    const deviceA = await pageAs(climber)
    const deviceB = await pageAs(climber)

    await gotoSettled(deviceA, `/route?id=${route.id}`)
    await deviceA.getByTestId('review-open-cta').click()
    await deviceA
        .getByTestId('review-form-rating')
        .getByRole('radio', { name: /4 out of 5$/ })
        .click()
    const comment = deviceA.getByTestId('review-form-comment').first()
    await comment.fill('Typed before the session ended')

    await gotoSettled(deviceB, '/account')
    await signOutFromOtherDevice(deviceB)

    await deviceA.getByTestId('review-form-submit').click()
    await expect(deviceA.getByTestId('review-form-dialog')).toBeVisible()
    await expect(comment).toHaveValue('Typed before the session ended')
    expect(await listRouteRatings(adminApi, route.id)).toEqual([])
    await expectSignInPrompt(deviceA, route.id)
})

test('a tick logged while the session ended elsewhere keeps its note and asks to sign in again', async ({
    pageAs,
    createUser,
    route,
}) => {
    const climber = await createUser('user', 'expiry-tick')
    const deviceA = await pageAs(climber)
    const deviceB = await pageAs(climber)

    await gotoSettled(deviceA, `/route?id=${route.id}`)
    await deviceA.getByTestId('tick-open').click()
    const note = deviceA.getByTestId('tick-note').first()
    await note.fill('Heel hook beta')

    await gotoSettled(deviceB, '/account')
    const keptSession = await signOutFromOtherDevice(deviceB)

    await deviceA.getByTestId('tick-submit').click()
    await expect(deviceA.getByTestId('tick-dialog')).toBeVisible()
    await expect(note).toHaveValue('Heel hook beta')
    expect(await listOwnTicks(keptSession, { route: route.id })).toEqual([])
    await expectSignInPrompt(deviceA, route.id)
})
