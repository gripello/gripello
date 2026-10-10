import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import {
    apiAs,
    createTick,
    notificationsOfType,
    waitForNotificationOfType,
} from '../../support/api'

test('the logbook shows achievements and the first one is announced', async ({
    page,
    createUser,
    route,
}) => {
    const climber = await createUser('user', 'badges')
    const climberApi = await apiAs(climber)
    await createTick(climberApi, {
        route: route.id,
        type: 'flash',
        attempts: 1,
        date: `${new Date().toISOString().slice(0, 10)}T12:00:00Z`,
    })

    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, '/logbook')
    await page.getByTestId('logbook-tab-badges').click()
    await expect(page.getByTestId('badge-sends')).toHaveAttribute(
        'data-tier',
        '1',
    )
    await expect(page.getByTestId('badge-sends')).toContainText('1 / 10')
    await expect(page.getByTestId('badge-flashes')).toHaveAttribute(
        'data-tier',
        '1',
    )
    await expect(page.getByTestId('badge-reviews')).toHaveAttribute(
        'data-tier',
        '0',
    )
    await expect(page.getByTestId('streak-current')).toContainText('1')

    await waitForNotificationOfType(climberApi, 'achievement_earned')
    const notifications = await notificationsOfType(
        climberApi,
        'achievement_earned',
    )
    expect(notifications).toHaveLength(1)
})
