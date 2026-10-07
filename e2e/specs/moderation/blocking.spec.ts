import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'

test('blocking a climber stops follows both ways and can be undone', async ({
    createUser,
    pageAs,
}) => {
    const blocker = await createUser('user', 'blocker')
    const blocked = await createUser('user', 'blocked')
    const blockerPage = await pageAs(blocker)
    const blockedPage = await pageAs(blocked)

    await gotoSettled(blockerPage, `/climber?id=${blocked.id}`)
    await blockerPage.getByTestId('climber-menu').click()
    await blockerPage.getByRole('menuitem', { name: /^Block$/ }).click()
    await blockerPage.getByTestId('confirm-dialog-confirm').click()

    const follow = await blockedPage.request.post(
        '/api/collections/follows/records',
        {
            headers: await authHeader(blockedPage),
            data: { follower: blocked.id, followee: blocker.id },
        },
    )
    expect(follow.status()).toBe(403)

    await gotoSettled(blockerPage, '/account/settings?tab=privacy')
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(1)
    await blockerPage.getByTestId('privacy-unblock').click()
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(0)
})

test('a block removes existing follows and hides the other person’s reviews', async ({
    root,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const blocker = await createUser('user', 'blocker')
    const blocked = await createUser('user', 'blocked')
    for (const [follower, followee] of [
        [blocker, blocked],
        [blocked, blocker],
    ]) {
        await root.collection('follows').create({
            follower: follower!.id,
            followee: followee!.id,
            status: 'accepted',
        })
    }
    const blockedPage = await pageAs(blocked)
    await gotoSettled(blockedPage, `/route?id=${route.id}`)
    const text = `${testPrefix}-their-review`
    const res = await blockedPage.request.post(
        '/api/collections/ratings/records',
        {
            headers: await authHeader(blockedPage),
            data: { route_id: route.id, rating: 3, comment: text },
        },
    )
    expect(res.ok()).toBe(true)

    const blockerPage = await pageAs(blocker)
    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    const reviews = blockerPage.getByTestId('route-reviews')
    await expect(reviews.getByText(text)).toBeVisible()

    await gotoSettled(blockerPage, `/climber?id=${blocked.id}`)
    await blockerPage.getByTestId('climber-menu').click()
    await blockerPage.getByRole('menuitem', { name: /^Block$/ }).click()
    await blockerPage.getByTestId('confirm-dialog-confirm').click()

    await expect
        .poll(
            async () =>
                (
                    await root.collection('follows').getFullList({
                        filter: root.filter(
                            '(follower = {:a} && followee = {:b}) || (follower = {:b} && followee = {:a})',
                            { a: blocker.id, b: blocked.id },
                        ),
                    })
                ).length,
        )
        .toBe(0)

    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    await expect(reviews.getByText(text)).toHaveCount(0)

    const profile = await blockedPage.request.get(
        `/api/climbers/${blocker.id}`,
        { headers: await authHeader(blockedPage) },
    )
    expect(profile.status()).toBe(404)

    await gotoSettled(blockerPage, '/account/settings?tab=privacy')
    await blockerPage.getByTestId('privacy-unblock').click()
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(0)
    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    await expect(reviews.getByText(text)).toBeVisible()
})
