import { test, expect } from '../../support/fixtures'
import { gymPath } from '../../support/nav'
import PocketBase from 'pocketbase'
import { ensureUser, getRoleIds } from '../../support/seed'

const PB_URL = process.env.E2E_PB_URL || 'https://localhost'

test('a leftover session of a deleted account still renders the site', async ({
    page,
    baseURL,
    root,
    testPrefix,
}) => {
    const roleIds = await getRoleIds(root)
    const ghost = await ensureUser(root, roleIds.user, 'user', testPrefix)

    const client = new PocketBase(PB_URL)
    await client
        .collection('users')
        .authWithPassword(ghost.email, ghost.password)
    const cookie = client.authStore.exportToCookie({}, 'pb_auth')
    await root.collection('users').delete(ghost.id)

    await page.context().addCookies([
        {
            name: 'pb_auth',
            value: cookie.split(';')[0]!.split('=').slice(1).join('='),
            url: baseURL!,
        },
    ])

    const response = await page.goto(gymPath('/'))
    expect(response?.status()).toBe(200)
    await expect(page.getByTestId('nav-login')).toBeVisible()
})
