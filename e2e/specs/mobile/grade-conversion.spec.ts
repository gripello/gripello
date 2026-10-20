import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('conversion ladders scroll inside the dialog on phones', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('index-grade-conversion-open').click()

    const dialog = page.getByTestId('grade-conversion-dialog')
    await expect(dialog.getByTestId('grade-conversion-boulders')).toBeVisible()
    await expect(dialog.getByTestId('grade-conversion-routes')).toBeVisible()
    await expect(dialog.getByTestId('grade-conversion-font-6A')).toBeVisible()

    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
            ),
        )
        .toBeLessThanOrEqual(0)
})
