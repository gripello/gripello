import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled, gymPath } from '../../support/nav'
import { createRoute, getMe, routeInput, updateMe } from '../../support/api'
import { fetchAuditRows } from '../../support/audit'

test('a user sees their own entries and nobody else’s', async ({
    createUser,
    pageAs,
    testPrefix,
}) => {
    const page = await pageAs(await createUser())
    await gotoSettled(page, gymPath('/'), /\//)

    const api = await apiOf(page)
    const myId = (await getMe(api)).id
    expect(myId).toBeTruthy()

    await updateMe(api, { firstname: `${testPrefix}-self` })

    const rows = await fetchAuditRows(page, {}, 'own')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
        expect(row.actor).toBe(myId)
    }
})

test('the activity page is reachable without any admin permission', async ({
    userPage: page,
}) => {
    await gotoSettled(page, '/account/activity', /\/account\/activity/)

    await expect(page.getByTestId('audit-retention-note')).toBeVisible()
    await expect(page.getByTestId('audit-filter-action')).toBeVisible()
})

test('a plain user reaches their activity from the user menu', async ({
    userPage: page,
}) => {
    await gotoSettled(page, gymPath('/'), /\//)

    await page.getByTestId('user-menu-activator').click()
    const entry = page.getByTestId('user-menu-activity')
    await expect(entry).toBeVisible()
    await expect(entry).toHaveAttribute('href', '/account/activity')
})

test('an admin sees entries from other actors too', async ({
    adminPage: page,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/account/activity', /\/account\/activity/)

    const routeId = (
        await createRoute(
            await apiOf(page),
            routeInput(`${testPrefix}-admin-visible`, workerLocation.id, {
                type: 'Boulder',
                creator: [testPrefix],
            }),
        )
    ).id

    const rows = await fetchAuditRows(page, { q: routeId })
    expect(rows.length).toBeGreaterThan(0)

    const all = await fetchAuditRows(page, {})
    const actors = new Set(all.map((r) => r.actor))
    expect(actors.size).toBeGreaterThan(0)
})
