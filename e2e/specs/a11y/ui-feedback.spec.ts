import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('stacks snackbars instead of replacing them', async ({ page }) => {
    await gotoSettled(page, '/auth/login')
    await page.getByTestId('login-goto-reset').click()
    await page.route('**/api/auth/password-reset/request', (route) =>
        route.abort('failed'),
    )
    await page.getByTestId('reset-email').fill('nobody@gripello.test')

    const submit = page.getByTestId('reset-submit')
    const messages = page.getByTestId('global-snackbar-message')
    await submit.click()
    await expect(messages).toHaveCount(1)
    await submit.click()
    await expect(messages).toHaveCount(2)
})

test('announces the number of routes found after searching', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-search').fill('no-such-route-e2e-xyz')
    await expect(page.locator('.nuxt-announcer')).toHaveText(/:\s*0$/)
})

test('shows a visible focus ring for keyboard focus', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid')
})

test('renders the navigation loading indicator', async ({ page }) => {
    await gotoSettled(page, '/routes')
    await expect(page.locator('.nuxt-loading-indicator')).toBeAttached()
})

test('keeps the global focus ring off text inputs', async ({ page }) => {
    await gotoSettled(page, '/routes')
    const search = page.getByTestId('filter-search')
    await search.focus()
    await expect(search).toHaveCSS('outline-offset', '0px')
})
