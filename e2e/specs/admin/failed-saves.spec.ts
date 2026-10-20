import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import {
    listCompetitionCategories,
    listOwnTicks,
    listRouteRatings,
    listTasks,
} from '../../support/api'

async function failOnce(page: Page, method: string, path: RegExp) {
    let failed = false
    await page.route(
        (url) => path.test(url.pathname),
        async (route) => {
            if (failed || route.request().method() !== method)
                return route.fallback()
            failed = true
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 500,
                    message: 'boom',
                    data: {},
                }),
            })
        },
    )
}

const errorToast = (page: Page) =>
    page.locator('[data-testid="global-snackbar-message"][data-color="error"]')

test('a tick that fails to save keeps its note and a double-click retry logs it once', async ({
    pageAs,
    createUser,
    route,
}) => {
    const climber = await createUser('user', 'tick-retry')
    const page = await pageAs(climber)
    const climberApi = await apiOf(page)
    await gotoSettled(page, `/route?id=${route.id}`)
    await failOnce(page, 'POST', /^\/api\/me\/ticks$/)

    await page.getByTestId('tick-open').click()
    const note = page.getByTestId('tick-note').first()
    await note.fill('Sit start')
    await page.getByTestId('tick-submit').click()

    await expect(errorToast(page)).toBeVisible()
    await expect(page.getByTestId('tick-dialog')).toBeVisible()
    await expect(note).toHaveValue('Sit start')

    await page.getByTestId('tick-submit').dblclick()
    await expect(page.getByTestId('tick-dialog')).toBeHidden()
    await expect
        .poll(async () =>
            (await listOwnTicks(climberApi, { route: route.id })).map(
                (tick) => tick.note,
            ),
        )
        .toEqual(['Sit start'])
})

test('a review that fails to save keeps its text and a double-click retry posts it once', async ({
    pageAs,
    createUser,
    adminApi,
    route,
}) => {
    const climber = await createUser('user', 'review-retry')
    const page = await pageAs(climber)
    await gotoSettled(page, `/route?id=${route.id}`)
    await failOnce(page, 'POST', /^\/api\/routes\/\w+\/ratings$/)

    await page.getByTestId('review-open-cta').click()
    await page
        .getByTestId('review-form-rating')
        .getByRole('radio', { name: /3 out of 5$/ })
        .click()
    const comment = page.getByTestId('review-form-comment').first()
    await comment.fill('Fun slab')
    await page.getByTestId('review-form-submit').click()

    await expect(errorToast(page)).toBeVisible()
    await expect(page.getByTestId('review-form-dialog')).toBeVisible()
    await expect(comment).toHaveValue('Fun slab')

    await page.getByTestId('review-form-submit').dblclick()
    await expect(page.getByTestId('review-form-dialog')).toBeHidden()
    await expect
        .poll(async () =>
            (await listRouteRatings(adminApi, route.id)).map(
                (rating) => rating.comment,
            ),
        )
        .toEqual(['Fun slab'])
})

test('a task that fails to save keeps its title and a double-click retry creates it once', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/manage/tasks'))
    await failOnce(page, 'POST', /^\/api\/gyms\/[^/]+\/tasks$/)

    const title = `${testPrefix} retry task`
    await page.getByTestId('tasks-new').click()
    await page.getByTestId('task-form-title').fill(title)
    await page.getByTestId('task-form-save').click()

    await expect(errorToast(page)).toBeVisible()
    await expect(page.getByTestId('task-form-dialog')).toBeVisible()
    await expect(page.getByTestId('task-form-title')).toHaveValue(title)

    await page.getByTestId('task-form-save').dblclick()
    await expect(page.getByTestId('task-form-dialog')).toBeHidden()
    await expect
        .poll(async () =>
            (await listTasks(adminApi, { q: title }))
                .filter((task) => task.title === title)
                .map((task) => task.title),
        )
        .toEqual([title])
})

test('a competition whose setup fails half way is finished by the retry, not created twice', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    await gotoSettled(page, gymPath('/manage/competitions'))
    await failOnce(page, 'POST', /^\/api\/competitions\/\w+\/categories$/)

    const dialog = page.getByTestId('competition-form-dialog')
    const name = `${testPrefix} Retry Cup`
    await page.getByTestId('competitions-new').click()
    await dialog.getByTestId('competition-form-name').fill(name)
    await dialog.getByTestId('competition-form-starts').fill('2030-10-10T10:00')
    await dialog.getByTestId('competition-form-ends').fill('2030-10-10T14:00')
    await dialog.getByTestId('competition-form-save').click()

    await expect(errorToast(page)).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('competition-form-name')).toHaveValue(name)

    await dialog.getByTestId('competition-form-save').dblclick()
    await expect(page).toHaveURL(/\/manage\/competitions\/\w+$/)
    const competitions = (
        await adminApi.get<{ items: { id: string; name: string }[] }>(
            '/gyms/e2e/competitions',
        )
    ).items.filter((competition) => competition.name === name)
    expect(competitions).toHaveLength(1)
    const names = (
        await listCompetitionCategories(adminApi, competitions[0]!.id)
    ).map((category) => category.name)
    expect(new Set(names).size).toBe(names.length)
})
