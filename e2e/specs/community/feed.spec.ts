import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import {
    apiAs,
    createBetaLink,
    createFollow,
    createTick,
    updateMe,
} from '../../support/api'

test('the feed shows new routes, betas and friends’ sends', async ({
    page,
    createUser,
    route,
}) => {
    const reader = await createUser('user', 'reader')
    const friend = await createUser('user', 'friend')
    const friendApi = await apiAs(friend)
    await updateMe(friendApi, { follow_policy: 'open' })
    await createFollow(await apiAs(reader), friend.id)
    await createBetaLink(friendApi, route.id, 'https://vm.tiktok.com/e2e-feed')
    await createTick(friendApi, {
        route: route.id,
        type: 'flash',
        attempts: 1,
        date: `${new Date().toISOString().slice(0, 10)}T12:00:00Z`,
    })

    await gotoSettled(page, '/e2e/feed')
    await expect(page.getByTestId('feed-routes')).toContainText(route.name)
    await expect(page.getByTestId('feed-betas')).toContainText('TikTok')
    await expect(page.getByTestId('feed-activity-empty')).toBeVisible()

    await signInAs(page, reader.email, reader.password)
    await gotoSettled(page, '/e2e/feed')
    await expect(page.getByTestId('feed-send').first()).toContainText(
        route.name,
    )
})
