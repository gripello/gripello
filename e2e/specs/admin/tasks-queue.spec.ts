import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import {
    archiveRoute,
    createDefect,
    getTask,
    listTasks,
    notificationsOfType,
} from '../../support/api'
import { reportDefect } from '../../support/tasks'

test('a setter fixes a reported defect and the reporter is notified', async ({
    setterPage,
    userPage,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSettled(userPage, `/route?id=${route.id}`)
    const taskId = await reportDefect(userPage, {
        routeId: route.id,
        description: `${testPrefix} loose bolt`,
    })

    await gotoSettled(setterPage, '/manage/tasks', /\/manage\/tasks/)
    const card = setterPage.getByTestId(`task-card-${taskId}`)
    await expect(card).toBeVisible()
    await expect(card.getByTestId('task-card-priority')).toBeVisible()

    await card.getByTestId('task-card-done').click()
    await expect(
        setterPage
            .getByTestId('task-column-done')
            .getByTestId(`task-card-${taskId}`),
    ).toBeVisible()

    const task = await getTask(adminApi, taskId)
    expect(task.done_by).toBeTruthy()
    expect(task.done_at).toBeTruthy()

    const userApi = await apiOf(userPage)
    await expect
        .poll(async () =>
            (await notificationsOfType(userApi, 'task_defect_fixed')).some(
                (item) =>
                    (item.params as { route?: string } | undefined)?.route ===
                    route.name,
            ),
        )
        .toBe(true)

    await gotoSettled(userPage, `/route?id=${route.id}`)
    await expect(userPage.getByTestId('task-defect-banner')).toBeHidden()
})

test('a setter drags a task across the board', async ({
    setterPage,
    adminApi,
    route,
    testPrefix,
}) => {
    const task = await createDefect(
        adminApi,
        route.id,
        `${testPrefix} tag missing`,
        'label_tag',
    )

    await gotoSettled(setterPage, '/manage/tasks', /\/manage\/tasks/)
    await setterPage
        .getByTestId('filter-search')
        .fill(`${testPrefix} tag missing`)
    const card = setterPage.getByTestId(`task-card-${task.id}`)
    await expect(setterPage.getByTestId('task-column-count-open')).toHaveText(
        '1',
    )
    await expect(
        setterPage
            .getByTestId('task-column-open')
            .getByTestId(`task-card-${task.id}`),
    ).toBeVisible()

    await card.dragTo(setterPage.getByTestId('task-column-in_progress'))

    await expect(
        setterPage
            .getByTestId('task-column-in_progress')
            .getByTestId(`task-card-${task.id}`),
    ).toBeVisible()
    await expect
        .poll(async () => (await getTask(adminApi, task.id)).status)
        .toBe('in_progress')
})

test('a task moves to waiting via the keyboard and stays a known problem', async ({
    setterPage,
    page,
    adminApi,
    route,
    testPrefix,
}) => {
    const task = await createDefect(
        adminApi,
        route.id,
        `${testPrefix} hold ordered`,
        'broken_hold',
    )

    await gotoSettled(setterPage, '/manage/tasks', /\/manage\/tasks/)
    const card = setterPage.getByTestId(`task-card-${task.id}`)
    await expect(card).toHaveAttribute('data-urgent', 'true')

    await card.getByTestId('task-card-move').focus()
    await setterPage.keyboard.press('Enter')
    await setterPage.getByTestId('task-move-waiting').click()

    await expect(
        setterPage
            .getByTestId('task-column-waiting')
            .getByTestId(`task-card-${task.id}`),
    ).toBeVisible()

    await gotoSettled(page, `/route?id=${route.id}`)
    await expect(page.getByTestId('task-defect-banner')).toBeVisible()
})

test('the urgent quick filter hides minor tasks', async ({
    setterPage,
    adminApi,
    route,
    testPrefix,
}) => {
    const urgent = await createDefect(
        adminApi,
        route.id,
        `${testPrefix} urgent`,
        'loose_bolt',
    )
    const minor = await createDefect(
        adminApi,
        route.id,
        `${testPrefix} minor`,
        'label_tag',
    )

    await gotoSettled(setterPage, '/manage/tasks', /\/manage\/tasks/)
    await expect(setterPage.getByTestId(`task-card-${minor.id}`)).toBeVisible()

    await setterPage.getByTestId('tasks-quick-urgent').click()

    await expect(setterPage.getByTestId(`task-card-${minor.id}`)).toBeHidden()
    await expect(setterPage.getByTestId(`task-card-${urgent.id}`)).toBeVisible()
})

test('a setter adds a task for a route from the route page', async ({
    setterPage,
    adminApi,
    route,
    testPrefix,
}) => {
    await gotoSettled(setterPage, `/route?id=${route.id}`)
    await setterPage.getByTestId('route-add-task').click()
    await setterPage
        .getByTestId('task-form-title')
        .fill(`${testPrefix} replace QR tag`)
    await setterPage.getByTestId('task-form-save').click()
    await expect(setterPage.getByTestId('task-form-dialog')).toBeHidden()

    const [task] = await listTasks(adminApi, { route: route.id })
    expect(task).toMatchObject({
        kind: 'maintenance',
        status: 'open',
        location: route.location,
    })
})

test('archiving a route closes its open tasks', async ({
    adminApi,
    route,
    testPrefix,
}) => {
    const task = await createDefect(
        adminApi,
        route.id,
        `${testPrefix} spins`,
        'spinning_hold',
    )

    await archiveRoute(adminApi, route.id)

    await expect
        .poll(async () => (await getTask(adminApi, task.id)).status)
        .toBe('done')
})

test('climbers cannot open the task queue', async ({ userPage }) => {
    await gotoSettled(userPage, '/manage/tasks')
    await expect(userPage).not.toHaveURL(/\/manage\/tasks/)
})
