import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('pdf export asks for language and fields before printing', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-select-all').click()
    await page.getByTestId('routes-export-pdf').click()

    const dialog = page.getByTestId('export-options-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('export-column-name')).toHaveCount(0)

    await page.getByTestId('export-locale').click()
    await page.getByRole('option', { name: 'Nederlands' }).click()
    await page.getByTestId('export-show-logo').uncheck()

    const request = page.waitForRequest('**/api/ui/pdf')
    const download = page.waitForEvent('download')
    await page.getByTestId('export-confirm').click()

    const body = (await request).postDataJSON()
    expect(body.locale).toBe('nl')
    expect(body.labels.anchor).toBe('Lijn')
    expect(body.show).toEqual({ creators: true, date: true, logo: false })
    const fs = await import('node:fs')
    const bytes = fs.readFileSync((await (await download).path())!)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
})

test('xlsx export translates headers into the chosen language', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-select-all').click()
    await page.getByTestId('routes-export-xlsx').click()

    await page.getByTestId('export-locale').click()
    await page.getByRole('option', { name: 'Deutsch' }).click()

    const request = page.waitForRequest('**/api/ui/xlsx')
    await page.getByTestId('export-confirm').click()

    const body = (await request).postDataJSON()
    expect(body.locale).toBe('de')
    expect(body.labels.name).toBe('Routenname')
    expect(body.labels.sheet).toBeTruthy()
})
