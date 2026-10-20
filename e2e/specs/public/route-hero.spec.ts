import { test, expect } from '../../support/fixtures'
import { gotoSettled, gotoSubscribed } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { createRating } from '../../support/api'
import { uiaa } from '../../support/seed'

test('the grade card opens the grade conversion', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('route-grade-badge').click()
    await expect(page.getByTestId('grade-conversion-dialog')).toBeVisible()
})

test('a grade vote shows the felt grade', async ({ page, adminApi, route }) => {
    await gotoSubscribed(page, `/route?id=${route.id}`, 'gym_changes:')
    const pill = page.getByTestId('route-perceived-grade')
    await expect(pill).toHaveCount(0)

    await createRating(adminApi, route.id, { rating: 4, ...uiaa('7-') })

    await expect(pill).toContainText('7-')
    await expect(pill).toContainText('1')
})

test('a send counts the climber once', async ({ page, createUser, route }) => {
    const climber = await createUser()
    await signInAs(page, climber.email, climber.password)
    await gotoSettled(page, `/route?id=${route.id}`)
    const sends = page.getByTestId('route-sends').getByTestId('stat-tile-value')
    await expect(sends).toHaveText('0')

    for (let i = 0; i < 2; i++) {
        await page.getByTestId('tick-open').click()
        await page.getByTestId('tick-type-top').click()
        await page.getByTestId('tick-submit').click()
        await expect(page.getByTestId('tick-submit')).toBeHidden()
        await expect(sends).toHaveText('1')
    }
})
