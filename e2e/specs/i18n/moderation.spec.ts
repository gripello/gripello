import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { projectLanguage, translate } from '../../support/i18n'

test('the moderation inbox speaks the gym’s language', async ({
    createUser,
    pageAs,
}, testInfo) => {
    const language = projectLanguage(testInfo)
    const adminPage = await pageAs(await createUser('admin', 'i18n-admin'))
    await gotoSettled(adminPage, '/manage/moderation')

    await expect(adminPage.locator('h1')).toHaveText(
        translate(language, 'moderation.title'),
    )
    const views = adminPage.getByTestId('moderation-views')
    for (const view of ['decide', 'approval', 'hidden', 'history']) {
        await expect(views).toContainText(
            translate(language, `moderation.views.${view}`),
        )
    }
    await expect(adminPage.locator('body')).not.toContainText('moderation.')
})
