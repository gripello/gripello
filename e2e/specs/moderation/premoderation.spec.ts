import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createModerationGym, decide, openCase } from '../../support/moderation'
import {
    deleteGym,
    getGym,
    listBetas,
    listModerationCases,
} from '../../support/api'

async function shareBeta(
    page: import('@playwright/test').Page,
    routeId: string,
    link: string,
) {
    await gotoSettled(page, `/route?id=${routeId}`)
    await page.getByTestId('beta-add').click()
    await page.getByTestId('beta-link').fill(link)
    await page.getByTestId('beta-submit').click()
}

test('a gym holds beta uploads until staff publish or decline them', async ({
    api,
    createUser,
    pageAs,
    testPrefix,
}) => {
    const gym = await createModerationGym(testPrefix)
    try {
        const staff = await pageAs(gym.staff)
        await gotoSettled(
            staff,
            `/${gym.slug}/admin/settings?section=moderation`,
        )
        await staff.getByTestId('settings-premoderate-betas').click()
        await staff.getByTestId('settings-save').click()
        await expect
            .poll(async () => (await getGym(api, gym.id)).premoderate_betas)
            .toBe(true)

        const climber = await pageAs(await createUser('user', 'uploader'))
        await shareBeta(
            climber,
            gym.routeId,
            'https://youtube.com/shorts/e2e-wait',
        )
        await expect(
            climber.getByTestId('global-snackbar-message').last(),
        ).toContainText(/waiting for approval/i)
        await expect(
            climber.getByTestId('beta-list').getByTestId('beta-video-link'),
        ).toHaveCount(0)

        const inbox = `/${gym.slug}/manage/moderation`
        await openCase(staff, 'shorts/e2e-wait', inbox, 'approval')
        await decide(staff, 'approve')
        await expect
            .poll(async () => (await listBetas(api, gym.routeId)).length)
            .toBe(1)

        await shareBeta(
            climber,
            gym.routeId,
            'https://youtube.com/shorts/e2e-no',
        )
        await openCase(staff, 'shorts/e2e-no', inbox, 'approval')
        await decide(staff, 'reject', 'Not a beta for this route.')
        const waiting = await listModerationCases(api, {
            gym: gym.id,
            state: ['pending'],
        })
        expect(waiting).toHaveLength(0)
        await gotoSettled(climber, `/route?id=${gym.routeId}`)
        await expect(
            climber.getByTestId('beta-list').getByTestId('beta-video-link'),
        ).toHaveCount(1)
    } finally {
        await deleteGym(api, gym.id)
    }
})
