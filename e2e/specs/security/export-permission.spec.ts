import { test, expect } from '../../support/fixtures'
import { e2eGymId } from '../../support/api'

test('a climber without manage_routes cannot generate exports', async ({
    request,
    apiAs,
    createUser,
}) => {
    const climber = await createUser('user', 'exporter')
    const { token } = await apiAs(climber)

    for (const format of ['pdf', 'xlsx', 'json']) {
        const response = await request.post(`/api/ui/${format}`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { gym: await e2eGymId(), ids: ['any-route'] },
        })
        expect(response.status(), format).toBe(403)
    }
})
