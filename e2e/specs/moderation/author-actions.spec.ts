import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createComment } from '../../support/comments'
import { createReport } from '../../support/reports'
import { openCase } from '../../support/moderation'
import {
    getPlatformUser,
    listRouteRatings,
    notificationsOfType,
} from '../../support/api'

test('the platform hides everything a spammer posted and suspends them', async ({
    platformPage,
    api,
    adminApi,
    apiAs,
    route,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const spammer = await createUser('user', 'spammer')
    const spamPage = await pageAs(spammer)
    await gotoSettled(spamPage, gymPath('/'))
    const first = await createComment(
        spamPage,
        route.id,
        `${testPrefix}-buy-one`,
    )
    const second = await createComment(
        spamPage,
        route.id,
        `${testPrefix}-buy-two`,
    )
    await createReport({
        contentId: first,
        explanation: `${testPrefix}-ads`,
    })

    await openCase(
        platformPage,
        `${testPrefix}-buy-one`,
        '/platform/moderation',
    )
    await platformPage
        .locator('[data-testid="moderation-author-hide"]:visible')
        .click()
    await platformPage.getByTestId('moderation-reason').fill('Advertising.')
    await platformPage.getByTestId('moderation-decision-confirm').click()

    for (const id of [first, second]) {
        await expect
            .poll(async () =>
                (await listRouteRatings(adminApi, route.id)).some(
                    (rating) => rating.id === id,
                )
                    ? 'visible'
                    : 'gone',
            )
            .toBe('gone')
    }
    const spammerApi = await apiAs(spammer)
    await expect
        .poll(
            async () =>
                (await notificationsOfType(spammerApi, 'content_hidden'))
                    .length,
        )
        .toBe(1)

    await gotoSettled(platformPage, '/platform/moderation')
    await platformPage.getByTestId('moderation-view-hidden').click()
    await platformPage
        .getByTestId('moderation-list')
        .getByRole('button', { name: new RegExp(`${testPrefix}-buy-two`) })
        .click()
    await platformPage
        .locator('[data-testid="moderation-author-suspend"]:visible')
        .click()
    await platformPage.getByTestId('platform-suspend-permanent').click()
    await platformPage
        .getByTestId('platform-suspend-reason')
        .fill('Spam account.')
    await platformPage.getByTestId('platform-suspend-confirm').click()
    await expect
        .poll(
            async () =>
                (await getPlatformUser(api, spammer.id)).suspended_until,
        )
        .toMatch(/^9999-/)
})
