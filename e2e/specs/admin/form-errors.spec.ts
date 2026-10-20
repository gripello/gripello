import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

function answerWithFieldError(
    page: Page,
    method: string,
    path: RegExp,
    field: string,
    code = 'validation_invalid_value',
) {
    return page.route(
        (url) => path.test(url.pathname),
        (route) =>
            route.request().method() === method
                ? route.fulfill({
                      status: 400,
                      contentType: 'application/json',
                      body: JSON.stringify({
                          status: 400,
                          message: 'Failed to validate.',
                          data: { [field]: { code, message: 'English' } },
                      }),
                  })
                : route.fallback(),
    )
}

async function expectFieldError(page: Page, testId: string, message: string) {
    const input = page.getByTestId(testId)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = (await input.getAttribute('aria-describedby')) ?? ''
    await expect(
        page.locator(
            `[id="${describedBy.split(' ').find((id) => id.endsWith('-error'))}"]`,
        ),
    ).toContainText(message)
}

test('the route form shows a server field error on the field and keeps the input', async ({
    adminPage: page,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/manage/routes'))
    await page.getByTestId('filter-search').fill(route.name)
    await page.getByTestId(`routes-row-${route.id}`).waitFor()
    await page.getByTestId('routes-row-edit').first().click()
    await answerWithFieldError(page, 'PATCH', /^\/api\/routes\/\w+$/, 'name')

    const renamed = `${testPrefix} renamed`
    await page.getByTestId('route-form-name').fill(renamed)
    await page.getByTestId('route-form-submit').click()

    await expectFieldError(page, 'route-form-name', 'This value is not valid.')
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
    await expect(page.getByTestId('route-form-name')).toHaveValue(renamed)
    await expect(page.getByTestId('global-snackbar')).toHaveCount(0)
})

test('the task form shows a server field error on the field and keeps the input', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/manage/tasks'))
    await page.getByTestId('tasks-new').click()
    await answerWithFieldError(
        page,
        'POST',
        /^\/api\/gyms\/[^/]+\/tasks$/,
        'title',
        'validation_required',
    )

    const title = `${testPrefix} fix the hold`
    await page.getByTestId('task-form-title').fill(title)
    await page.getByTestId('task-form-save').click()

    await expectFieldError(page, 'task-form-title', 'This field is required.')
    await expect(page.getByTestId('task-form-dialog')).toBeVisible()
    await expect(page.getByTestId('task-form-title')).toHaveValue(title)
    await expect(page.getByTestId('global-snackbar')).toHaveCount(0)
})

test('the competition form shows a server field error on the field and keeps the input', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/manage/competitions'))
    await page.getByTestId('competitions-new').click()
    await answerWithFieldError(
        page,
        'POST',
        /^\/api\/gyms\/[^/]+\/competitions$/,
        'ends_at',
    )

    const dialog = page.getByTestId('competition-form-dialog')
    const name = `${testPrefix} Cup`
    await dialog.getByTestId('competition-form-name').fill(name)
    await dialog.getByTestId('competition-form-starts').fill('2030-10-10T10:00')
    await dialog.getByTestId('competition-form-ends').fill('2030-10-10T14:00')
    await dialog.getByTestId('competition-form-save').click()

    await expectFieldError(
        page,
        'competition-form-ends',
        'This value is not valid.',
    )
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('competition-form-name')).toHaveValue(name)
    await expect(page.getByTestId('global-snackbar')).toHaveCount(0)
})
