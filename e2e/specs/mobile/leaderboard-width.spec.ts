import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { gradeOf } from '../../support/seed'

test('a long send name keeps the leaderboard within the phone width', async ({
    page,
    root,
    createUser,
    createRoute,
    testPrefix,
}) => {
    const climber = await createUser('user', 'wide')
    const route = await createRoute({
        type: 'Boulder',
        name: `${testPrefix} Schwarzwälder Kirschtorte mit extra viel Sahne`,
        ...gradeOf('font', '6B'),
    })
    await root.collection('ticks').create({
        user: climber.id,
        route: route.id,
        type: 'top',
        attempts: 2,
        date: `${new Date().toISOString().slice(0, 10)} 12:00:00.000Z`,
    })

    await page.setViewportSize({ width: 360, height: 740 })
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, '/e2e/leaderboard')
    await expect(page.getByTestId('leaderboard-my-sends')).toBeVisible()

    const overflow = await page.evaluate(
        () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
})
