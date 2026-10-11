import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('row checkboxes and select-all reflect the selected route ids', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await createRoute()
    await createRoute()

    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)

    const boxes = page.getByTestId('routes-row-checkbox')
    await expect(boxes).toHaveCount(2)
    await expect(boxes.first()).not.toBeChecked()

    await boxes.first().click()
    await expect(boxes.first()).toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
    await expect(page.getByTestId('routes-archive-selected')).toBeVisible()
    const selectAll = page.getByTestId('routes-select-all')
    await expect(selectAll).toHaveText('1 selected')
    await expect(selectAll).toHaveAttribute('title', 'Select all')

    await selectAll.click()
    await expect(boxes.first()).toBeChecked()
    await expect(boxes.nth(1)).toBeChecked()
    await expect(selectAll).toHaveText('2 selected')
    await expect(selectAll).toHaveAttribute('title', 'Deselect all')

    await selectAll.click()
    await expect(selectAll).toHaveText('Select all')
    await expect(boxes.first()).not.toBeChecked()
    await expect(boxes.nth(1)).not.toBeChecked()
    await expect(page.getByTestId('routes-archive-selected')).toHaveCount(0)
})

test('repeated select-all reuses the loaded id list', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    await createRoute()
    await createRoute()

    await page.route('**/api/realtime**', (route) => route.abort())
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)

    let idListRequests = 0
    page.on('request', (request) => {
        const url = new URL(request.url())
        if (
            /^\/api\/gyms\/[^/]+\/routes$/.test(url.pathname) &&
            url.searchParams.get('limit') === '1000'
        ) {
            idListRequests++
        }
    })

    const boxes = page.getByTestId('routes-row-checkbox')
    const selectAll = page.getByTestId('routes-select-all')

    await selectAll.click()
    await expect(boxes.nth(1)).toBeChecked()
    await selectAll.click()
    await expect(boxes.nth(1)).not.toBeChecked()
    await selectAll.click()
    await expect(boxes.nth(1)).toBeChecked()

    expect(idListRequests).toBe(1)
})
