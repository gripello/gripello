import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import {
    acceptFollow,
    createFollow,
    createRating,
    listFollows,
} from '../../support/api'

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

    await expect(
        createFollow(await apiOf(blockedPage), blocker.id),
    ).rejects.toMatchObject({ status: 400 })

    await gotoSettled(blockerPage, '/account/settings?tab=privacy')
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(1)
    await blockerPage.getByTestId('privacy-unblock').click()
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(0)
})

test('a block removes existing follows and hides the other person’s reviews', async ({
    route,
    createUser,
    apiAs,
    pageAs,
    testPrefix,
}) => {
    const blocker = await createUser('user', 'blocker')
    const blocked = await createUser('user', 'blocked')
    for (const [follower, followee] of [
        [blocker, blocked],
        [blocked, blocker],
    ]) {
        const follow = await createFollow(await apiAs(follower!), followee!.id)
        if (follow.status !== 'accepted')
            await acceptFollow(await apiAs(followee!), follow.id)
    }
    const blockedPage = await pageAs(blocked)
    await gotoSettled(blockedPage, `/route?id=${route.id}`)
    const text = `${testPrefix}-their-review`
    await createRating(await apiOf(blockedPage), route.id, {
        rating: 3,
        comment: text,
    })

    const blockerPage = await pageAs(blocker)
    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    const reviews = blockerPage.getByTestId('route-reviews')
    await expect(reviews.getByText(text)).toBeVisible()

    await gotoSettled(blockerPage, `/climber?id=${blocked.id}`)
    await blockerPage.getByTestId('climber-menu').click()
    await blockerPage.getByRole('menuitem', { name: /^Block$/ }).click()
    await blockerPage.getByTestId('confirm-dialog-confirm').click()

    const blockerApi = await apiAs(blocker)
    await expect
        .poll(
            async () =>
                (await listFollows(blockerApi)).filter(
                    (follow) =>
                        follow.follower === blocked.id ||
                        follow.followee === blocked.id,
                ).length,
        )
        .toBe(0)

    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    await expect(reviews.getByText(text)).toHaveCount(0)

    await expect(
        (await apiOf(blockedPage)).get(`/climbers/${blocker.id}`),
    ).rejects.toMatchObject({ status: 404 })

    await gotoSettled(blockerPage, '/account/settings?tab=privacy')
    await blockerPage.getByTestId('privacy-unblock').click()
    await expect(blockerPage.getByTestId('privacy-blocked')).toHaveCount(0)
    await gotoSettled(blockerPage, `/route?id=${route.id}`)
    await expect(reviews.getByText(text)).toBeVisible()
})
