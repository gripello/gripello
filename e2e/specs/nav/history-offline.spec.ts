import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { signInAs } from '../../support/auth'

test.use({
    launchOptions: { args: ['--ignore-certificate-errors'] },
    serviceWorkers: 'allow',
})

async function visitOnline(page: Page, path: string) {
    await gotoSettled(page, path)
    await page.waitForFunction(
        () => navigator.serviceWorker?.controller !== null,
    )
    await gotoSettled(page, path)
}

async function coldStartOffline(context: BrowserContext, path: string) {
    await context.setOffline(true)
    const page = await context.newPage()
    await page.goto(path).catch(() => {})
    return page
}

for (const link of ['scanned', 'gym'] as const) {
    test(`a ${link} route link opens offline after one online visit`, async ({
        page,
        context,
        route,
    }) => {
        const path =
            link === 'scanned'
                ? `/route?id=${route.id}`
                : `${gymPath('/route')}?id=${route.id}`
        await visitOnline(page, path)
        await page.close()
        try {
            const offline = await coldStartOffline(context, path)
            await expect(offline.getByTestId('offline-page')).toHaveCount(0)
            await expect(offline.getByText(route.name).first()).toBeVisible()
        } finally {
            await context.setOffline(false)
        }
    })
}

test('staff and account pages are never served from the offline cache', async ({
    page,
    context,
    createUser,
}) => {
    const setter = await createUser('routesetter', 'offline-staff')
    await signInAs(page, setter.email, setter.password)
    const paths = [gymPath('/manage/routes'), '/account']
    for (const path of paths) await visitOnline(page, path)
    try {
        for (const path of paths) {
            const offline = await coldStartOffline(context, path)
            await expect(offline.getByTestId('offline-page')).toBeVisible()
            await offline.close()
        }
    } finally {
        await context.setOffline(false)
    }
})
