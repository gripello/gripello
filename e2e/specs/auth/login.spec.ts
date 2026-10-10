import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'

test.describe('login', () => {
    test('logs in with valid credentials and lands on the dashboard', async ({
        page,
    }) => {
        await gotoSettled(page, '/auth/login')
        await fillLogin(page, 'e2e-admin@gripello.test', 'E2ePassw0rd!')
        await page.getByTestId('login-submit').click()
        await page.waitForURL('**/manage/routes')
        await expect(page.getByTestId('routes-create-open')).toBeVisible({
            timeout: 15_000,
        })

        await expect(page.getByTestId('global-snackbar').last()).toBeHidden()
    })

    test('shows an error for invalid credentials', async ({ page }) => {
        await gotoSettled(page, '/auth/login')
        await fillLogin(page, 'e2e-admin@gripello.test', 'wrong-password')
        await page.getByTestId('login-submit').click()
        await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
        await expect(page).toHaveURL(/\/auth\/login/)
    })

    test('shows an error when the login request fails outright', async ({
        page,
    }) => {
        await gotoSettled(page, '/auth/login')
        let aborted = 0
        await page.route(/\/api\/auth\/login$/, (route) => {
            aborted++
            return route.abort('failed')
        })
        await fillLogin(page, 'e2e-admin@gripello.test', 'E2ePassw0rd!')
        await page.getByTestId('login-submit').click()
        await expect(page.getByTestId('global-snackbar').last()).toBeVisible()
        await expect(page).toHaveURL(/\/auth\/login/)
        expect(aborted).toBeGreaterThan(0)
    })

    test('navigates to the password-reset request form', async ({ page }) => {
        await gotoSettled(page, '/auth/login')
        await page.getByTestId('login-goto-reset').click()
        await expect(page.getByTestId('reset-form')).toBeVisible()
        await expect(page.getByTestId('reset-email')).toBeVisible()
    })
})
