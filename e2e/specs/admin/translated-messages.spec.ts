import { Workbook } from '@cj-tech-master/excelts'
import { test, expect } from '../../support/fixtures'
import { e2eGym } from '../../support/seed'
import { authHeader, gotoSettled } from '../../support/nav'

test('adding an existing member shows a readable message', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')
    await page.getByTestId('member-invite-open').click()
    await page
        .getByTestId('member-invite-email')
        .fill('e2e-routesetter@gripello.test')
    await page.getByTestId('member-invite-submit').click()

    await expect(page.getByTestId('global-snackbar').last()).toContainText(
        'This person is already a member.',
    )
})

test('settings image labels and the logo alt text come from i18n', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/settings')
    await expect(page.getByTestId('settings-asset-label-logo')).toHaveText(
        'App logo',
    )
    await expect(page.getByTestId('settings-asset-label-icon')).toHaveText(
        'Browser icon',
    )
    await expect(page.getByTestId('settings-asset-label-sign')).toHaveText(
        'Logo on route labels',
    )

    const logo = page.getByTestId('nav-logo').locator('img').first()
    await expect(logo).toHaveAttribute('alt', /\S/)
    await expect(logo).not.toHaveAttribute('alt', 'Logo')
})

test('xlsx worksheet is named from the sent label without invalid characters', async ({
    adminPage: page,
    route,
}) => {
    await gotoSettled(page, '/manage/routes')
    const headers = await authHeader(page)

    const response = await page.request.post('/api/ui/xlsx', {
        headers,
        data: {
            gym: await e2eGym(),
            ids: [route.id],
            columns: ['name'],
            labels: {
                sheet: 'Kletter/routen: [Halle] Nord mit sehr langem Namen',
            },
        },
    })
    expect(response.ok()).toBe(true)

    const workbook = new Workbook()
    await workbook.xlsx.load(await response.body())
    expect(workbook.worksheets[0]!.name).toBe('Kletterrouten Halle Nord mit se')
})
