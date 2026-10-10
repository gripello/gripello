import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('fetches the role list once per page load', async ({
    adminPage: page,
}) => {
    const roleRequests: string[] = []
    page.on('request', (req) => {
        if (/\/api\/gyms\/[^/]+\/roles(\?|$)/.test(req.url())) {
            roleRequests.push(req.url())
        }
    })

    await gotoSettled(page, '/admin/users')
    await expect(page.getByTestId('member-invite-open')).toBeVisible()

    expect(roleRequests.length).toBeLessThanOrEqual(1)
})

test('the role picker is populated without a fetch of its own', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')
    await page.getByTestId('member-invite-open').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeVisible()

    await page.getByTestId('member-invite-role').click()
    await expect(page.getByRole('option').first()).toBeVisible()
})
