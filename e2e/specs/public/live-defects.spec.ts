import { test, expect } from '../../support/fixtures'
import { createTask, setTaskStatus } from '../../support/api'
import { gotoSubscribed } from '../../support/nav'

test('a filed and fixed defect shows up live on the open route page', async ({
    page,
    adminApi,
    route,
}) => {
    await gotoSubscribed(page, `/route?id=${route.id}`, 'open_route_defects')
    const banner = page.getByTestId('task-defect-banner')
    await expect(banner).toHaveCount(0)

    const task = await createTask(adminApi, {
        kind: 'defect',
        route: route.id,
        category: 'loose_hold',
    })
    await expect(banner).toBeVisible()

    await setTaskStatus(adminApi, task.id, 'done')
    await expect(banner).toHaveCount(0)
})
