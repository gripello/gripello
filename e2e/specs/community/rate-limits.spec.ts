import type { Page, Route } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { fillLogin } from '../../support/auth'
import { apiAs, updateMe } from '../../support/api'

const RATE_LIMITED = 'Too many requests. Wait a moment and try again.'

const tooManyRequests = (route: Route, message = 'Too many requests.') =>
    route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ status: 429, message, data: {} }),
    })

async function expectPasswordError(page: Page, message: string) {
    const input = page.getByTestId('login-password')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = (await input.getAttribute('aria-describedby')) ?? ''
    await expect(
        page.locator(
            `[id="${describedBy.split(' ').find((id) => id.endsWith('-error'))}"]`,
        ),
    ).toHaveText(message)
}

test('a rate-limited climber search says so instead of finding nobody', async ({
    pageAs,
    createUser,
}) => {
    const page = await pageAs(await createUser('user', 'searcher'))
    await gotoSettled(page, '/friends')
    await page.route(
        (url) => url.pathname === '/api/climbers' && url.searchParams.has('q'),
        (route) => tooManyRequests(route),
    )

    await page.getByTestId('friends-search').fill('Someone')

    await expect(page.getByTestId('friends-search-error')).toContainText(
        RATE_LIMITED,
    )
    await expect(page.getByTestId('friends-no-results')).toHaveCount(0)
})

test('a rate-limited follow says so', async ({
    pageAs,
    createUser,
    testPrefix,
}) => {
    const ben = await createUser('user', 'limited-ben')
    const benName = `Lim${testPrefix.replace(/\D/g, '')}`
    await updateMe(await apiAs(ben), { firstname: benName, name: 'Boulder' })
    const page = await pageAs(await createUser('user', 'limited-anna'))
    await gotoSettled(page, '/friends')
    await page.route(
        (url) => url.pathname === '/api/follows',
        (route) => tooManyRequests(route),
    )

    await page.getByTestId('friends-search').fill(benName)
    await page.getByTestId(`follow-${ben.id}`).click()

    await expect(page.getByTestId('global-snackbar-message')).toHaveText(
        RATE_LIMITED,
    )
})

test('the login form names a locked account and a plain rate limit', async ({
    page,
}) => {
    await gotoSettled(page, '/auth/login')
    let answer = 'Account temporarily locked. Try again later.'
    await page.route(/\/api\/auth\/login$/, (route) =>
        tooManyRequests(route, answer),
    )

    await fillLogin(page, 'e2e-admin@gripello.test', 'whatever-1')
    await page.getByTestId('login-submit').click()
    await expectPasswordError(
        page,
        'Too many failed attempts. Try again in 15 minutes.',
    )

    answer = ''
    await page.getByTestId('login-submit').click()
    await expectPasswordError(
        page,
        'Too many sign-in attempts. Please try again later.',
    )
})
