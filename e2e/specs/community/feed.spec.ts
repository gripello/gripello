import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'

test('the feed shows new routes, betas and friends’ sends', async ({
    page,
    root,
    createUser,
    route,
}) => {
    const reader = await createUser('user', 'reader')
    const friend = await createUser('user', 'friend')
    await root.collection('users').update(friend.id, { follow_policy: 'open' })
    await root
        .collection('follows')
        .create({ follower: reader.id, followee: friend.id })
    await root.collection('beta_videos').create({
        user: friend.id,
        route: route.id,
        url: 'https://vm.tiktok.com/e2e-feed',
    })
    await root.collection('ticks').create({
        user: friend.id,
        route: route.id,
        type: 'flash',
        attempts: 1,
        date: `${new Date().toISOString().slice(0, 10)} 12:00:00.000Z`,
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
