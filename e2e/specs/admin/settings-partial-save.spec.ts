import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { getGym } from '../../support/api'

test('saving settings only sends the fields that were edited', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    await gotoSettled(page, '/admin/settings?section=organization')
    const current = await getGym(adminApi, E2E_GYM_SLUG)

    let sentFields: string[] = []
    await page.route(/\/api\/gyms\/[^/?]+(\?|$)/, async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const body = route.request().postDataJSON()
        sentFields = Object.keys(body)
        await route.fulfill({ json: { ...current, ...body } })
    })

    await page.getByTestId('settings-org-name').fill(`${testPrefix}-org`)
    await page.getByTestId('settings-save').click()
    await expect(page.getByTestId('settings-save')).toBeHidden()

    expect(sentFields).toEqual(['name'])
})
