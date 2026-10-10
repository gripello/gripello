import type { Locator } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { createTask, getTask, setTaskStatus } from '../../support/api'
import { gotoSettled } from '../../support/nav'

test('the mobile board shows one status at a time behind tabs', async ({
    setterPage: page,
    adminApi,
    route,
    testPrefix,
}) => {
    const task = await createTask(adminApi, {
        kind: 'defect',
        route: route.id,
        category: 'label_tag',
        description: `${testPrefix} tag faded`,
    })
    await setTaskStatus(adminApi, task.id, 'in_progress')

    await gotoSettled(page, '/manage/tasks', /\/manage\/tasks/)
    await page.getByTestId('filter-search').fill(`${testPrefix} tag faded`)

    const tabs = page.getByTestId('task-board-tabs')
    await expect(tabs).toBeVisible()
    await expect(page.getByTestId('task-column-open')).toBeVisible()
    await expect(page.getByTestId('task-column-in_progress')).toHaveCount(0)

    await tabs.getByRole('tab', { name: /in progress/i }).click()

    await expect(
        page
            .getByTestId('task-column-in_progress')
            .getByTestId(`task-card-${task.id}`),
    ).toBeVisible()
})

async function touch(
    target: Locator,
    type: 'touchstart' | 'touchmove' | 'touchend',
    point: { x: number; y: number },
) {
    await target.evaluate(
        (element, { type, x, y }) => {
            const finger = new Touch({
                identifier: 1,
                target: element,
                clientX: x,
                clientY: y,
            })
            const active = type === 'touchend' ? [] : [finger]
            element.dispatchEvent(
                new TouchEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    touches: active,
                    targetTouches: active,
                    changedTouches: [finger],
                }),
            )
        },
        { type, ...point },
    )
}

async function centerOf(locator: Locator) {
    const box = (await locator.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('a long press drags a card onto another status', async ({
    setterPage: page,
    adminApi,
    route,
    testPrefix,
}) => {
    const task = await createTask(adminApi, {
        kind: 'defect',
        route: route.id,
        category: 'sharp_edge',
        description: `${testPrefix} sharp edge`,
    })

    await gotoSettled(page, '/manage/tasks', /\/manage\/tasks/)
    await page.getByTestId('filter-search').fill(`${testPrefix} sharp edge`)
    const card = page.getByTestId(`task-card-${task.id}`)
    await expect(card).toBeVisible()

    const start = await centerOf(card)
    await touch(card, 'touchstart', start)
    await expect(page.getByTestId('task-drop-overlay')).toBeVisible()

    const waiting = page.getByTestId('task-drop-waiting')
    const dropPoint = await centerOf(waiting)
    await touch(card, 'touchmove', dropPoint)
    await expect(waiting).toHaveClass(/ring-primary/)
    await touch(card, 'touchend', dropPoint)

    await expect(page.getByTestId('task-drop-overlay')).toBeHidden()
    await expect
        .poll(async () => (await getTask(adminApi, task.id)).status)
        .toBe('waiting')
})
