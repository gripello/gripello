import { test, expect } from '../../support/fixtures'
import { guestApi, listAudit } from '../../support/api'

for (const header of ['X-Forwarded-For', 'X-Real-IP']) {
    test(`a client cannot pick its own IP through ${header}`, async ({
        api,
        testPrefix,
    }) => {
        const identity = `spoof@${testPrefix}-${header.toLowerCase()}.test`
        const spoofedIp = '127.0.0.1'
        const maskedIdentity = `s***${identity.slice(identity.indexOf('@'))}`

        await expect(
            guestApi().post(
                '/auth/login',
                { identity, password: 'wrong-password-1' },
                { [header]: spoofedIp },
            ),
        ).rejects.toMatchObject({ status: 400 })

        const recordedIp = async () =>
            (
                await listAudit(api, 'platform', {
                    action: 'login_failed',
                    q: maskedIdentity,
                })
            )[0]?.ip ?? null

        await expect.poll(recordedIp).not.toBeNull()
        expect(await recordedIp()).not.toBe(spoofedIp)
    })
}
