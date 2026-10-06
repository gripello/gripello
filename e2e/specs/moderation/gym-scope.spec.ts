import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { reportAs } from '../../support/reports'
import { createModerationGym, openCase } from '../../support/moderation'

test('only report handlers see who reported and why', async ({
    adminPage,
    setterPage,
    userPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-scoped`
    const commentId = await createComment(author, route.id, text)
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: commentId,
        explanation: `${testPrefix}-why`,
        notifierName: `${testPrefix}-Nora`,
    })

    const setterView = await openCase(setterPage, text)
    await expect(setterView).toContainText('Spam or fraud')
    await expect(setterView).not.toContainText(`${testPrefix}-Nora`)
    await expect(setterView).not.toContainText(`${testPrefix}-why`)

    const adminView = await openCase(adminPage, text)
    await expect(adminView).toContainText(`${testPrefix}-Nora`)
    await expect(adminView).toContainText(`${testPrefix}-why`)
})

test('staff of another gym never see this gym’s cases', async ({
    root,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-foreign`
    await createComment(author, route.id, text)
    const item = await root
        .collection('moderation_items')
        .getFirstListItem(root.filter('snapshot ~ {:text}', { text }))

    const gym = await createModerationGym(root, testPrefix)
    try {
        const outsider = await pageAs(gym.staff)
        await gotoSettled(
            outsider,
            `/${gym.slug}/manage/moderation?case=${item.id}`,
        )
        await expect(
            outsider.getByTestId('moderation-list').getByText(text),
        ).toHaveCount(0)
        await expect(
            outsider.locator('article[data-testid^="moderation-detail-"]'),
        ).toHaveCount(0)
        const direct = await outsider.request.get(
            `/api/collections/moderation_items/records/${item.id}`,
        )
        expect(direct.status()).toBe(404)
    } finally {
        await root.collection('gyms').delete(gym.id)
    }
})

test('profile cases stay with the platform', async ({
    adminPage,
    platformPage,
    root,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'profile')
    await root
        .collection('users')
        .update(person.id, { firstname: `${testPrefix}-Rude` })

    await gotoSettled(adminPage, `/manage/moderation?search=${testPrefix}-Rude`)
    await expect(adminPage.getByTestId('moderation-empty')).toBeVisible()

    await openCase(platformPage, `${testPrefix}-Rude`, '/platform/moderation')
})
