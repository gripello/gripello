import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { archiveRoute, getRoute, updateRoute } from '../../support/api'
import { uiaa } from '../../support/seed'

async function openRouteForm(page: Page, route: { id: string; name: string }) {
    await gotoSettled(page, gymPath('/manage/routes'))
    await page.getByTestId('filter-search').fill(route.name)
    await page
        .locator('tr', { has: page.getByTestId(`routes-row-${route.id}`) })
        .getByTestId('routes-row-edit')
        .click()
    await expect(page.getByTestId('route-form-dialog')).toBeVisible()
}

async function pickGrade(page: Page, grade: string) {
    await page.getByTestId('route-form-difficulty').click()
    await page.getByRole('option', { name: grade, exact: true }).click()
}

test('a grade fix saved from an open form keeps a route archived meanwhile', async ({
    setterPage: page,
    adminApi,
    route,
}) => {
    await openRouteForm(page, route)
    await archiveRoute(adminApi, route.id)

    await pickGrade(page, '6')
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    const saved = await getRoute(adminApi, route.id)
    expect(saved.archived).toBe(true)
    expect(saved.grade).toBe(uiaa('6').grade)
})

test('two setters editing different fields of one route both keep their change', async ({
    setterPage: page,
    adminApi,
    route,
    testPrefix,
}) => {
    await openRouteForm(page, route)
    await updateRoute(adminApi, route.id, uiaa('7'))

    const renamed = `${testPrefix} renamed`
    await page.getByTestId('route-form-name').fill(renamed)
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    const saved = await getRoute(adminApi, route.id)
    expect(saved.name).toBe(renamed)
    expect(saved.grade).toBe(uiaa('7').grade)
})

test('a long imported route name stays editable', async ({
    setterPage: page,
    adminApi,
    createRoute,
    testPrefix,
}) => {
    const longName = `${testPrefix} `.padEnd(60, 'x')
    const route = await createRoute({ name: longName })

    await openRouteForm(page, route)
    const name = page.getByTestId('route-form-name')
    await expect(name).toHaveValue(longName)
    await name.press('End')
    await name.pressSequentially('yz')
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    expect((await getRoute(adminApi, route.id)).name).toBe(`${longName}yz`)
})
