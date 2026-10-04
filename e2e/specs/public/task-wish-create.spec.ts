import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('a visitor wishes for a boulder in a location', async ({
    page,
    root,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('index-wish-open').click()
    const dialog = page.getByTestId('task-wish-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('task-wish-submit')).toBeDisabled()

    const location = await root.collection('locations').getOne(route.location)
    await page.getByTestId('task-wish-location').click()
    await page.getByRole('option', { name: location.name }).click()
    await page.getByTestId('task-wish-type-boulder').click()
    await page
        .getByTestId('task-wish-description')
        .fill(`${testPrefix} a slab with small crimps`)
    await page.getByTestId('task-wish-submit').click()
    await expect(dialog).toBeHidden()

    const task = await root
        .collection('tasks')
        .getFirstListItem(
            root.filter('description ~ {:prefix}', { prefix: testPrefix }),
        )
    expect(task).toMatchObject({
        kind: 'wish',
        route_type: 'Boulder',
        location: route.location,
        route: '',
        status: 'open',
        reporter: '',
    })
})
