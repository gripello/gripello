import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import {
    deleteGym,
    getModerationCase,
    listModerationCases,
    updateMe,
} from '../../support/api'
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
    api,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    const text = `${testPrefix}-foreign`
    await createComment(author, route.id, text)
    const [item] = await listModerationCases(api, { q: text })
    expect(item).toBeTruthy()

    const gym = await createModerationGym(testPrefix)
    try {
        const outsider = await pageAs(gym.staff)
        await gotoSettled(
            outsider,
            `/${gym.slug}/manage/moderation?case=${item!.id}`,
        )
        await expect(
            outsider.getByTestId('moderation-list').getByText(text),
        ).toHaveCount(0)
        await expect(
            outsider.locator('article[data-testid^="moderation-detail-"]'),
        ).toHaveCount(0)
        await expect(
            getModerationCase(await apiOf(outsider), item!.id),
        ).rejects.toMatchObject({ status: 404 })
    } finally {
        await deleteGym(api, gym.id)
    }
})

test('profile cases stay with the platform', async ({
    adminPage,
    platformPage,
    apiAs,
    createUser,
    testPrefix,
}) => {
    const person = await createUser('user', 'profile')
    await updateMe(await apiAs(person), { firstname: `${testPrefix}-Rude` })

    await gotoSettled(adminPage, `/manage/moderation?search=${testPrefix}-Rude`)
    await expect(adminPage.getByTestId('moderation-empty')).toBeVisible()

    await openCase(platformPage, `${testPrefix}-Rude`, '/platform/moderation')
})
