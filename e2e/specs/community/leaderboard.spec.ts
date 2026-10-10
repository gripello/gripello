import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { gradeOf } from '../../support/seed'
import {
    apiAs,
    createSeason,
    createTick,
    getMe,
    updateMe,
} from '../../support/api'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

test('a season ranks the best sends and leaves out hidden climbers', async ({
    page,
    adminApi,
    createUser,
    createRoute,
    testPrefix,
}) => {
    const leader = await createUser('user', 'leader')
    const second = await createUser('user', 'second')
    const hidden = await createUser('user', 'hidden')
    await updateMe(await apiAs(leader), { firstname: 'Lea', name: 'Leader' })
    await updateMe(await apiAs(second), { firstname: 'Sam', name: 'Second' })
    await updateMe(await apiAs(hidden), { leaderboard_hidden: true })

    const hard = await createRoute({
        type: 'Boulder',
        ...gradeOf('font', '7A'),
    })
    const easy = await createRoute({
        type: 'Boulder',
        ...gradeOf('font', '6A'),
    })
    const tick = async (user: typeof leader, route: string, type: string) =>
        createTick(await apiAs(user), {
            route,
            type,
            attempts: 1,
            date: `${today()}T12:00:00Z`,
        })
    await tick(leader, hard.id, 'flash')
    await tick(leader, easy.id, 'top')
    await tick(second, easy.id, 'top')
    await tick(hidden, hard.id, 'top')

    const season = await createSeason(adminApi, {
        name: `${testPrefix} season`,
        starts_at: `${daysAgo(3)}T00:00:00Z`,
        ends_at: `${daysAgo(-3)}T00:00:00Z`,
    })

    await signInAs(page, leader.email, leader.password)
    await gotoSettled(page, '/e2e/leaderboard')
    await page.getByTestId('leaderboard-season').click()
    await page.getByRole('option', { name: season.name }).click()

    const leaderRow = page.getByTestId(`leaderboard-row-${leader.id}`)
    const secondRow = page.getByTestId(`leaderboard-row-${second.id}`)
    await expect(leaderRow).toContainText('Lea L.')
    await expect(leaderRow.getByTestId('leaderboard-score')).toHaveText(
        /3[.,]?633/,
    )
    await expect(secondRow).toContainText('Sam S.')
    await expect(page.getByTestId(`leaderboard-row-${hidden.id}`)).toHaveCount(
        0,
    )
    await expect(page.getByTestId('leaderboard-window')).toContainText('–')
    await expect(page.getByTestId('leaderboard-stats')).toContainText('2')
    await expect(page.getByTestId('leaderboard-ahead')).toContainText('—')
    await expect(page.getByTestId('leaderboard-my-sends')).toContainText(
        hard.name,
    )
    await expect(page.getByTestId('leaderboard-top-routes')).toContainText(
        easy.name,
    )
    await expect(page.getByTestId('logbook-pyramid')).toBeVisible()

    await page.getByTestId('leaderboard-kind').getByText('Routes').click()
    await expect(leaderRow).toHaveCount(0)
})

test('hidden climbers are told how to show up again', async ({
    page,
    createUser,
}) => {
    const climber = await createUser('user', 'shy')
    const climberApi = await apiAs(climber)
    await updateMe(climberApi, { leaderboard_hidden: true })
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, '/e2e/leaderboard')
    await expect(page.getByTestId('leaderboard-hidden')).toBeVisible()

    await gotoSettled(page, '/account/settings?tab=privacy')
    await page.getByTestId('privacy-leaderboard').click()
    await expect
        .poll(async () => (await getMe(climberApi)).leaderboard_hidden)
        .toBe(false)
})

test('staff manage seasons and the TV view shows the board', async ({
    adminPage: page,
    testPrefix,
}) => {
    await gotoSettled(page, '/e2e/leaderboard')
    await page.getByTestId('leaderboard-seasons-open').click()
    const dialog = page.getByTestId('seasons-dialog')
    await dialog.getByTestId('season-name').fill(`${testPrefix} spring`)
    await dialog.getByTestId('season-start').fill(daysAgo(10))
    await dialog.getByTestId('season-end').fill(daysAgo(20))
    await dialog.getByTestId('season-save').click()
    await expect(dialog).toContainText('end has to be after')

    await dialog.getByTestId('season-end').fill(daysAgo(1))
    await dialog.getByTestId('season-save').click()
    await expect(dialog.getByText(`${testPrefix} spring`)).toBeVisible()

    await page.goto('/e2e/leaderboard/tv')
    await expect(page.getByTestId('leaderboard-tv')).toBeVisible()
})

test('climbers without staff rights see no season tools', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/e2e/leaderboard')
    await expect(page.getByTestId('leaderboard-kind')).toBeVisible()
    await expect(page.getByTestId('leaderboard-seasons-open')).toHaveCount(0)
})
