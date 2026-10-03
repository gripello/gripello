import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { e2eGymId } from '../../support/seed'

test('saving settings only sends the fields that were edited', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    await gotoSettled(page, '/admin/settings?section=organization')
    const current = await root.collection('gyms').getOne(await e2eGymId(root))

    let sentFields: string[] = []
    await page.route('**/api/collections/gyms/records/**', async (route) => {
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
