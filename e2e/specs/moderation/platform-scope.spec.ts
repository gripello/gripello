import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { reportAs } from '../../support/reports'
import { createModerationGym, decide, openCase } from '../../support/moderation'
import {
    createBetaLink,
    deleteGym,
    listModerationCases,
    updateGym,
} from '../../support/api'

test('the platform queue holds reported cases, all gyms holds the rest', async ({
    platformPage,
    userPage,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const author = await pageAs(await createUser('user', 'author'))
    await gotoSettled(author, gymPath('/'))
    await createComment(author, route.id, `${testPrefix}-quiet`)
    const loud = await createComment(author, route.id, `${testPrefix}-loud`)
    await reportAs(userPage, {
        contentType: 'rating',
        contentId: loud,
        explanation: `${testPrefix}-report`,
    })

    await gotoSettled(platformPage, `/platform/moderation?search=${testPrefix}`)
    const list = platformPage.getByTestId('moderation-list')
    await expect(list.getByText(`${testPrefix}-loud`)).toBeVisible()
    await expect(list.getByText(`${testPrefix}-quiet`)).toHaveCount(0)

    await platformPage.getByTestId('moderation-view-all').click()
    await expect(list.getByText(`${testPrefix}-quiet`)).toBeVisible()

    await gotoSettled(
        platformPage,
        `/platform/moderation?search=${testPrefix}&gym=nosuchgym000000`,
    )
    await expect(platformPage.getByTestId('moderation-empty')).toBeVisible()
})

test('the platform can take down a waiting upload but never publish it', async ({
    platformPage,
    api,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const gym = await createModerationGym(testPrefix)
    try {
        await updateGym(api, gym.id, { premoderate_betas: true })
        const uploader = await pageAs(await createUser('user', 'uploader'))
        expect(
            await createBetaLink(
                await apiOf(uploader),
                gym.routeId,
                `https://youtube.com/shorts/${testPrefix}`,
            ),
        ).toMatchObject({ pending: true })

        await openCase(
            platformPage,
            `shorts/${testPrefix}`,
            '/platform/moderation',
            'all',
        )
        await expect(
            platformPage.locator('[data-testid="moderation-approve"]:visible'),
        ).toHaveCount(0)
        await decide(platformPage, 'hide', 'Illegal content.')

        const caseOfUpload = async () =>
            (
                await listModerationCases(api, {
                    content_type: 'beta_video',
                    q: `shorts/${testPrefix}`,
                })
            )[0]
        await expect
            .poll(async () => (await caseOfUpload())?.state)
            .toBe('hidden')
        expect((await caseOfUpload())?.hidden_by).toBe('platform')
    } finally {
        await deleteGym(api, gym.id)
    }
})
