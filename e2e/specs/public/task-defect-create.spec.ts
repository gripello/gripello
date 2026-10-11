import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { PNG_PIXEL } from '../../support/tasks'
import { createTask, getTask, guestApi, listTasks } from '../../support/api'
import type { OpenRouteDefectRecord } from '../../../types/models'

test('a visitor reports a defect with a photo and sees the known-issue banner', async ({
    page,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSettled(page, `/route?id=${route.id}`)
    await expect(page.getByTestId('task-defect-banner')).toBeHidden()

    await page.getByTestId('task-defect-open').click()
    const dialog = page.getByTestId('task-defect-dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('task-defect-submit')).toBeDisabled()

    await page.getByTestId('task-defect-category-loose_bolt').click()
    await page
        .getByTestId('task-defect-description')
        .fill(`${testPrefix} bolt at the third clip turns`)
    await dialog.locator('input[type="file"]').setInputFiles({
        name: 'bolt.png',
        mimeType: 'image/png',
        buffer: PNG_PIXEL,
    })
    await page.getByTestId('task-defect-submit').click()

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('task-defect-banner')).toBeVisible()

    const [task] = await listTasks(adminApi, { route: route.id })
    expect(task).toMatchObject({
        kind: 'defect',
        category: 'loose_bolt',
        priority: 4,
        status: 'open',
        reporter: '',
    })
    expect(task!.photo).toBeTruthy()
})

test('visitors cannot read task details, only the public defect summary', async ({
    adminApi,
    route,
    testPrefix,
}) => {
    await createTask(adminApi, {
        kind: 'defect',
        route: route.id,
        category: 'sharp_edge',
        description: `${testPrefix} private details`,
    })

    await expect(listTasks(guestApi())).rejects.toMatchObject({ status: 401 })

    const {
        items: [defect],
    } = await guestApi().get<{ items: OpenRouteDefectRecord[] }>(
        `/routes/${route.id}/defects`,
    )
    expect(defect.category).toBe('sharp_edge')
    expect(defect).not.toHaveProperty('description')
})

test('a visitor cannot file a staff task', async ({ adminApi, route }) => {
    const { id } = await createTask(guestApi(), {
        kind: 'reset',
        title: 'Strip everything',
        route: route.id,
        category: 'other',
        priority: 1,
    })
    const task = await getTask(adminApi, id)
    expect(task).toMatchObject({ kind: 'defect', title: '', priority: 2 })
})
