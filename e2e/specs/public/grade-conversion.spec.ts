import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('visitors find the conversion table on the routes page', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('index-grade-conversion-open').click()
    const dialog = page.getByTestId('grade-conversion-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('grade-conversion-font-6A')).toBeVisible()
    await dialog.getByTestId('grade-conversion-tabs-routes').click()
    await expect(dialog.getByTestId('grade-conversion-french-6a')).toBeVisible()
})
