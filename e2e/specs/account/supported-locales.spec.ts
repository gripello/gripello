import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { updateMe } from '../../support/api'
import { SUPPORTED_LOCALES } from '../../../app/utils/locales'

test('every supported locale is offered in the profile and accepted by the users collection', async ({
    apiAs,
    createUser,
    pageAs,
}) => {
    const user = await createUser()
    const userApi = await apiAs(user)

    for (const { code } of SUPPORTED_LOCALES) {
        const updated = await updateMe(userApi, { language: code })
        expect(updated.language).toBe(code)
    }

    await updateMe(userApi, { language: 'en' })
    const page = await pageAs(user)
    await gotoSettled(page, '/account/settings?tab=preferences')
    await page.getByTestId('profile-language').click()
    await expect(
        page.locator('[data-testid^="profile-language-"]'),
    ).toHaveCount(SUPPORTED_LOCALES.length)
    for (const { code, name } of SUPPORTED_LOCALES) {
        await expect(
            page.getByTestId(`profile-language-${code}`),
        ).toContainText(name)
    }
})
