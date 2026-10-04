import { test, expect } from '../../support/fixtures'
import { signInAs } from '../../support/auth'
import { gotoSettled, gymPath } from '../../support/nav'

test.use({
    launchOptions: { args: ['--ignore-certificate-errors'] },
    serviceWorkers: 'allow',
})

test('a staff page is not served from the cache after signing out', async ({
    page,
    context,
    createUser,
}) => {
    const setter = await createUser('routesetter', 'sw-setter')
    await signInAs(page, setter.email, setter.password)
    await gotoSettled(page, gymPath('/manage/routes'))
    await page.waitForFunction(
        () => navigator.serviceWorker?.controller !== null,
    )

    const response = await page.reload()
    expect(response?.headers()['cache-control']).toContain('no-store')
    await expect(page.getByTestId('page-hydrated')).toBeAttached()

    await context.clearCookies()
    try {
        await context.setOffline(true)
        await page.goto(gymPath('/manage/routes'))
        await expect(page.getByTestId('offline-page')).toBeVisible()
    } finally {
        await context.setOffline(false)
    }
})
