import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { e2eGymId } from '../../support/seed'

test('privacy page is server-rendered and public', async ({ page }) => {
    const response = await page.goto('/privacy')
    expect(response?.status()).toBe(200)
    const html = (await response?.text()) ?? ''
    expect(html).toContain('data-testid="privacy-storage"')
    expect(html).toContain('data-testid="privacy-rights"')
})

test('imprint page is public and links to privacy', async ({ page }) => {
    await gotoSettled(page, '/imprint')
    await expect(page.getByTestId('imprint-page')).toBeVisible()
    await page
        .getByTestId('imprint-page')
        .getByRole('link', { name: /privacy/i })
        .click()
    await expect(page).toHaveURL(/\/privacy$/)
})

test('logged-in users can open the legal pages', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/privacy', /\/privacy$/)
    await expect(page.getByTestId('privacy-page')).toBeVisible()
})

test('every cookie and localStorage key the app sets is disclosed', async ({
    adminPage: page,
    baseURL,
}) => {
    for (const path of [
        '/',
        '/manage/routes',
        '/manage/inventory',
        '/account/activity',
    ]) {
        await gotoSettled(page, path)
    }

    const appHost = new URL(baseURL!).hostname
    const cookieNames = (await page.context().cookies())
        .filter((cookie) => appHost.endsWith(cookie.domain.replace(/^\./, '')))
        .map((cookie) => cookie.name)
    const storageKeys = await page.evaluate(() => Object.keys(localStorage))
    const databaseNames = await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name ?? ''),
    )
    const usedNames = [
        ...new Set([...cookieNames, ...storageKeys, ...databaseNames]),
    ]
    expect(usedNames.length).toBeGreaterThan(0)

    await gotoSettled(page, '/privacy')
    const disclosedNames = await page
        .getByTestId('privacy-storage-row')
        .locator('code')
        .allTextContents()

    for (const name of usedNames) {
        expect(disclosedNames, `undisclosed client storage: ${name}`).toContain(
            name,
        )
    }
})

test('the gym imprint names the gym and links to the platform imprint', async ({
    page,
    root,
}) => {
    const gymId = await e2eGymId(root)
    const before = await root.collection('gyms').getOne(gymId)
    await root
        .collection('gyms')
        .update(gymId, { legal_address: 'Climbing Street 1\n12345 Rocktown' })
    try {
        await gotoSettled(page, gymPath('/imprint'))
        await expect(page.getByTestId('gym-imprint-page')).toBeVisible()
        await expect(page.getByTestId('imprint-name')).toHaveText(before.name)
        await expect(page.getByTestId('imprint-address')).toContainText(
            'Climbing Street 1',
        )
        await expect(page.getByTestId('footer-imprint')).toHaveAttribute(
            'href',
            gymPath('/imprint'),
        )

        await page.getByTestId('gym-imprint-platform-link').click()
        await page.waitForURL((url) => url.pathname === '/imprint')
        await expect(page.getByTestId('imprint-page')).toBeVisible()
    } finally {
        await root
            .collection('gyms')
            .update(gymId, { legal_address: before.legal_address })
    }
})

test('the gym privacy notice names the gym as controller', async ({ page }) => {
    await gotoSettled(page, gymPath('/privacy'))
    await expect(page.getByTestId('privacy-controller')).toBeVisible()
    await expect(page.getByTestId('gym-privacy-platform-link')).toHaveAttribute(
        'href',
        '/privacy',
    )
})
