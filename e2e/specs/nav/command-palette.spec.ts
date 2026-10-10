import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

test('opens with the keyboard shortcut and jumps to a route', async ({
    page,
}) => {
    await gotoSettled(page, gymPath('/'))
    await page.keyboard.press('ControlOrMeta+k')

    const input = page.getByTestId('command-palette-input')
    await expect(input).toBeFocused()
    await input.fill('e2e-route-1')

    const results = page.getByTestId('command-palette-result')
    await expect(results.first()).toContainText('e2e-route-1')
    await input.press('Enter')
    await page.waitForURL(/\/route\?id=/)
})

test('lists permitted pages for signed-in users', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('command-palette-open').click()
    const input = page.getByTestId('command-palette-input')
    await expect(input).toBeFocused()
    await input.fill('Users')
    await page.getByTestId('command-palette-result').first().click()
    await page.waitForURL('**/admin/users')
})

test('shows an empty state when nothing matches', async ({ page }) => {
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('command-palette-open').click()
    await page
        .getByTestId('command-palette-input')
        .fill('no-such-thing-e2e-xyz')
    await expect(page.getByTestId('command-palette-empty')).toBeVisible()
})

test('finds routes by setter and shows grade and setter', async ({ page }) => {
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('command-palette-open').click()
    await page.getByTestId('command-palette-input').fill('Setter 2')
    await expect(page.getByTestId('command-palette-group-routes')).toBeVisible()
    await expect(
        page.getByTestId('command-palette-result').first(),
    ).toContainText('Setter 2')
})

test('moves the selection with the arrow keys', async ({ page }) => {
    await gotoSettled(page, gymPath('/'))
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByTestId('command-palette-input')
    await input.fill('e2e-route-1')
    const results = page.getByTestId('command-palette-result')
    await expect(results.nth(1)).toBeVisible()
    await input.press('ArrowDown')
    await expect(results.nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(results.first()).not.toHaveAttribute('aria-current', 'true')
})

async function paletteSearch(
    page: import('@playwright/test').Page,
    text: string,
) {
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('command-palette-open').click()
    await page.getByTestId('command-palette-input').fill(text)
}

test.describe('admin search across the app', () => {
    test('finds members and opens them on the users page', async ({
        adminPage: page,
    }) => {
        await paletteSearch(page, 'e2e-routesetter@gripello.test')
        const group = page.getByTestId('command-palette-group-users')
        await expect(group).toBeVisible()
        await page
            .getByTestId('command-palette-result')
            .filter({ hasText: 'e2e-routesetter@gripello.test' })
            .first()
            .click()
        await page.waitForURL(/\/admin\/users\?search=/)
        await expect(page.getByTestId('filter-search')).toHaveValue(
            'e2e-routesetter@gripello.test',
        )
    })

    test('finds roles', async ({ adminPage: page }) => {
        await paletteSearch(page, 'routesetter')
        await expect(
            page.getByTestId('command-palette-group-roles'),
        ).toBeVisible()
    })

    test('finds review content', async ({ adminPage: page }) => {
        await paletteSearch(page, 'e2e-rating-')
        await expect(
            page.getByTestId('command-palette-group-reviews'),
        ).toBeVisible()
    })

    test('jumps to a settings section', async ({ adminPage: page }) => {
        await paletteSearch(page, 'Privacy URL')
        await expect(
            page.getByTestId('command-palette-group-settings'),
        ).toBeVisible()
        await page
            .getByTestId('command-palette-result')
            .filter({ hasText: 'Privacy URL' })
            .click()
        await page.waitForURL(/\/admin\/settings\?section=urls/)
    })
})

test('never queries admin data without permission', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/'))
    const forbidden: string[] = []
    page.on('request', (request) => {
        if (
            /\/api\/(gyms\/[^/]+\/(roles|ratings|members)|moderation\/cases|platform\/users)(\?|$)/.test(
                request.url(),
            )
        )
            forbidden.push(request.url())
    })
    await page.getByTestId('command-palette-open').click()
    await page.getByTestId('command-palette-input').fill('e2e')
    await expect(page.getByTestId('command-palette-group-routes')).toBeVisible()
    for (const group of ['users', 'roles', 'reviews', 'reports', 'settings'])
        await expect(
            page.getByTestId(`command-palette-group-${group}`),
        ).toHaveCount(0)
    expect(forbidden).toEqual([])
})
