import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createModerationGym,
    decide,
    inboxCount,
    openCase,
} from '../../support/moderation'
import {
    apiAs,
    createRating,
    deleteGym,
    fileReport,
    guestApi,
} from '../../support/api'

async function openRows(page: Page, inbox: string) {
    let rows = 0
    for (const view of ['decide', 'approval'] as const) {
        await gotoSettled(page, inbox)
        await page.getByTestId(`moderation-view-${view}`).click()
        const list = page.getByTestId('moderation-list')
        const empty = page.getByTestId('moderation-empty')
        await expect(list.or(empty)).toBeVisible()
        await expect(page.getByTestId('moderation-load-more')).toHaveCount(0)
        rows += await list
            .locator(
                '[data-testid^="moderation-case-"]:not([data-testid="moderation-case-text"])',
            )
            .count()
    }
    return rows
}

async function expectBadgeMatchesInbox(page: Page, inbox: string) {
    await expect
        .poll(async () => {
            const rows = await openRows(page, inbox)
            return (await inboxCount(page)) - rows
        })
        .toBe(0)
}

test('the moderation badge always counts the open rows of the inbox', async ({
    api,
    pageAs,
    createUser,
    testPrefix,
}) => {
    const gym = await createModerationGym(testPrefix)
    try {
        const staff = await pageAs(gym.staff)
        const inbox = `/${gym.slug}/manage/moderation`
        const climberApi = await apiAs(await createUser('user', 'badge-author'))
        const kept = `${testPrefix}-kept`
        const reported = `${testPrefix}-reported`
        await createRating(climberApi, gym.routeId, {
            rating: 4,
            comment: kept,
        })
        const { id } = await createRating(climberApi, gym.routeId, {
            rating: 1,
            comment: reported,
        })
        await fileReport(guestApi(), {
            contentType: 'rating',
            contentId: id,
            explanation: reported,
        })
        await expect.poll(() => openRows(staff, inbox)).toBe(2)
        await expectBadgeMatchesInbox(staff, inbox)

        await openCase(staff, reported, inbox)
        await decide(staff, 'hide', 'Spam')
        await expectBadgeMatchesInbox(staff, inbox)

        await openCase(staff, reported, inbox, 'hidden')
        await decide(staff, 'restore')
        await expectBadgeMatchesInbox(staff, inbox)

        await openCase(staff, kept, inbox)
        await decide(staff, 'approve')
        await expectBadgeMatchesInbox(staff, inbox)
        expect(await inboxCount(staff)).toBeLessThan(2)
    } finally {
        await deleteGym(api, gym.id)
    }
})
