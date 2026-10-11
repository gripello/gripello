import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { apiAs, createTick, updateMe } from '../../support/api'

test('climbers follow each other and see sends in the feed', async ({
    page,
    pageAs,
    createUser,
    route,
    testPrefix,
}) => {
    const anna = await createUser('user', 'anna')
    const ben = await createUser('user', 'ben')
    const benName = `Ben${testPrefix.replace(/\D/g, '')}`
    const benApi = await apiAs(ben)
    await updateMe(benApi, { firstname: benName, name: 'Boulder' })

    const benPage = await pageAs(ben)
    await gotoSettled(benPage, '/friends')
    await expect(benPage.getByTestId('friends-me')).toContainText(benName)
    await expect(benPage.getByTestId('friends-requests')).toHaveCount(0)

    await signInAs(page, anna.email, anna.password)
    await gotoSettled(page, '/friends')
    await page.getByTestId('friends-search').fill(benName)
    await page.getByTestId(`follow-${ben.id}`).click()
    await expect(
        page.getByTestId('friends-results').getByTestId(`unfollow-${ben.id}`),
    ).toContainText('Requested')

    await expect(benPage.getByTestId(`friends-person-${anna.id}`)).toBeVisible()
    await benPage.getByTestId('friends-accept').click()
    await expect(benPage.getByTestId('friends-requests')).toHaveCount(0)
    await expect(benPage.getByTestId('friends-count-followers')).toContainText(
        '1',
    )

    const day = new Date().toISOString().slice(0, 10)
    await createTick(benApi, {
        route: route.id,
        type: 'top',
        attempts: 3,
        date: `${day}T12:00:00Z`,
        note: `${testPrefix} private note`,
    })

    await gotoSettled(page, '/friends')
    const send = page.getByTestId('friends-feed').getByTestId('feed-send')
    await expect(send).toContainText(route.name)
    await expect(send).toContainText(benName)
    await expect(send).not.toContainText('private note')

    await gotoSettled(page, `/climber?id=${ben.id}`)
    await expect(page.getByTestId('climber-name')).toHaveText(
        `${benName} Boulder`,
    )
    await page.getByTestId('climber-kind').getByText('Routes').click()
    await expect(page.getByTestId('compare-sends')).toContainText('1')
    await expect(page.getByTestId('climber-suggestions')).toContainText(
        route.name,
    )
    await expect(page.getByTestId('climber-recent')).toContainText(route.name)
    await expect(page.getByTestId('badge-sends')).toHaveAttribute(
        'data-tier',
        '1',
    )

    await gotoSettled(page, '/friends')
    await page.getByTestId('friends-my-profile').click()
    await expect(page).toHaveURL(`/climber?id=${anna.id}`)
    await expect(page.getByTestId('climber-edit')).toBeVisible()

    await updateMe(benApi, { ticks_private: true })
    await gotoSettled(page, `/climber?id=${ben.id}`)
    await expect(page.getByTestId('climber-locked')).toContainText('private')
    await gotoSettled(page, '/friends')
    await expect(page.getByTestId('friends-feed-empty')).toBeVisible()
})

test('a closed logbook can not be found or followed', async ({
    page,
    createUser,
    testPrefix,
}) => {
    const seeker = await createUser('user', 'seeker')
    const loner = await createUser('user', 'loner')
    const lonerName = `Lone${testPrefix.replace(/\D/g, '')}`
    await updateMe(await apiAs(loner), {
        firstname: lonerName,
        follow_policy: 'closed',
    })

    await signInAs(page, seeker.email, seeker.password)
    await gotoSettled(page, '/friends')
    await page.getByTestId('friends-search').fill(lonerName)
    await expect(page.getByTestId('friends-no-results')).toBeVisible()

    const response = await page.goto(`/climber?id=${loner.id}`)
    expect(response?.status()).toBe(404)
})

test('the friends page asks guests to sign in', async ({ page }) => {
    await page.goto('/friends')
    await page.waitForURL((url) => url.pathname === '/auth/login')
})
