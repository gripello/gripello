import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { reportAs } from '../../support/reports'
import { createModerationGym, decide, openCase } from '../../support/moderation'

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
    root,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const gym = await createModerationGym(root, testPrefix)
    try {
        await root
            .collection('gyms')
            .update(gym.id, { premoderate_betas: true })
        const uploaderUser = await createUser('user', 'uploader')
        const uploader = await pageAs(uploaderUser)
        const upload = await uploader.request.post(
            '/api/collections/beta_videos/records',
            {
                headers: await authHeader(uploader),
                data: {
                    route: gym.routeId,
                    user: uploaderUser.id,
                    url: `https://youtube.com/shorts/${testPrefix}`,
                },
            },
        )
        expect(upload.status()).toBe(202)

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

        const caseOfUpload = () =>
            root.collection('moderation_items').getFirstListItem(
                root.filter('content_type = "beta_video" && snapshot ~ {:p}', {
                    p: `shorts/${testPrefix}`,
                }),
            )
        await expect
            .poll(async () => (await caseOfUpload()).state)
            .toBe('hidden')
        expect((await caseOfUpload()).hidden_by).toBe('platform')
    } finally {
        await root.collection('gyms').delete(gym.id)
    }
})
