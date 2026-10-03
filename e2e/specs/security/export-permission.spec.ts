import { test, expect } from '../../support/fixtures'
import PocketBase from 'pocketbase'
import { e2eGym, ensureUser, getRoleIds } from '../../support/seed'

const PB_URL = process.env.E2E_PB_URL || 'https://localhost'

test('a climber without manage_routes cannot generate exports', async ({
    request,
    root,
    testPrefix,
}) => {
    const roleIds = await getRoleIds(root)
    const climber = await ensureUser(root, roleIds.user, 'user', testPrefix)

    const client = new PocketBase(PB_URL)
    await client
        .collection('users')
        .authWithPassword(climber.email, climber.password)

    for (const format of ['pdf', 'xlsx', 'json']) {
        const response = await request.post(`/api/ui/${format}`, {
            headers: { Authorization: client.authStore.token },
            data: { gym: await e2eGym(), ids: ['any-route'] },
        })
        expect(response.status(), format).toBe(403)
    }
})
