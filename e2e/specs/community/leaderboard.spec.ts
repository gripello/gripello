import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { e2eGymId, gradeOf } from '../../support/seed'

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

test('a season ranks the best sends and leaves out hidden climbers', async ({
    page,
    root,
    createUser,
    createRoute,
    testPrefix,
}) => {
    const leader = await createUser('user', 'leader')
    const second = await createUser('user', 'second')
    const hidden = await createUser('user', 'hidden')
    await root
        .collection('users')
        .update(leader.id, { firstname: 'Lea', name: 'Leader' })
    await root
        .collection('users')
        .update(second.id, { firstname: 'Sam', name: 'Second' })
    await root
        .collection('users')
        .update(hidden.id, { leaderboard_hidden: true })

    const hard = await createRoute({
        type: 'Boulder',
        ...gradeOf('font', '7A'),
    })
    const easy = await createRoute({
        type: 'Boulder',
        ...gradeOf('font', '6A'),
    })
    const tick = (user: string, route: string, type: string) =>
        root.collection('ticks').create({
            user,
            route,
            type,
            attempts: 1,
            date: `${today()} 12:00:00.000Z`,
        })
    await tick(leader.id, hard.id, 'flash')
    await tick(leader.id, easy.id, 'top')
    await tick(second.id, easy.id, 'top')
    await tick(hidden.id, hard.id, 'top')

    const season = await root.collection('seasons').create({
        gym: await e2eGymId(root),
        name: `${testPrefix} season`,
        starts_at: `${daysAgo(3)} 00:00:00.000Z`,
        ends_at: `${daysAgo(-3)} 00:00:00.000Z`,
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
    root,
    createUser,
}) => {
    const climber = await createUser('user', 'shy')
    await root
        .collection('users')
        .update(climber.id, { leaderboard_hidden: true })
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, '/e2e/leaderboard')
    await expect(page.getByTestId('leaderboard-hidden')).toBeVisible()

    await gotoSettled(page, '/account/settings?tab=privacy')
    await page.getByTestId('privacy-leaderboard').click()
    await expect
        .poll(
            async () =>
                (await root.collection('users').getOne(climber.id))
                    .leaderboard_hidden,
        )
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
