import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createGym,
    createLocation,
    createRoute,
    addMembership,
    deleteGym,
    findRole,
    routeInput,
    updateGym,
} from '../../support/api'

const script = '<script>window.__injected=1</script>'
const image = '<img src=x onerror="window.__injected=1">'

test('gym description and route name render as text', async ({
    page,
    api,
    apiAs,
    createUser,
    testPrefix,
}) => {
    const slug = `e2e-markup-${Date.now()}`
    const gym = await createGym(api, { slug, name: 'E2E Markup', active: true })
    try {
        const description = `${script} ${image}`
        await updateGym(api, gym.id, { description })
        const admin = await createUser()
        const role = await findRole(api, 'admin', gym.id)
        await addMembership(api, admin.id, role.id, gym.id)
        const staff = await apiAs(admin)
        const location = await createLocation(staff, `${testPrefix} Hall`, slug)
        const name = `${testPrefix} ${image}`
        await createRoute(staff, routeInput(name, location.id), slug)

        page.on('dialog', (dialog) => {
            throw new Error(`dialog fired: ${dialog.message()}`)
        })

        for (const path of [`/${slug}/info`, `/${slug}/routes`]) {
            const html = (await (await page.request.get(path)).text()).replace(
                /="[^"]*"/g,
                '=""',
            )
            expect(html).not.toContain(script)
            expect(html).not.toContain(image)
        }

        await gotoSettled(page, `/${slug}/info`)
        await expect(page.getByTestId('gym-info-description')).toHaveText(
            description,
        )

        await gotoSettled(page, `/${slug}/routes`)
        await expect(page.getByText(name, { exact: true })).toBeVisible()

        expect(await page.locator('img[onerror]').count()).toBe(0)
        expect(
            await page.evaluate(
                () => (window as { __injected?: number }).__injected,
            ),
        ).toBeUndefined()
    } finally {
        await deleteGym(api, gym.id)
    }
})
