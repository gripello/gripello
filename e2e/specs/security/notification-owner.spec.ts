import { test, expect } from '../../support/fixtures'
import {
    createNotificationFor,
    deleteNotification,
    guestApi,
    listNotifications,
    markNotificationsRead,
    type Api,
} from '../../support/api'

const find = async (api: Api, id: string) =>
    (await listNotifications(api)).find((item) => item.id === id)

test('a user can mark a notification read but not hand it to someone else', async ({
    apiAs,
    createUser,
    testPrefix,
}) => {
    const owner = await createUser('user', 'a')
    const victim = await createUser('user', 'b')
    const id = createNotificationFor(
        owner.id,
        'report_filed',
        { snippet: testPrefix },
        '/manage/reports',
    )
    const ownerApi = await apiAs(owner)

    for (const change of [
        { user: victim.id },
        { url: '/auth/login' },
        { params: { snippet: 'spoofed' } },
        { type: 'report_decided_removed' },
    ]) {
        await expect(
            ownerApi.patch(`/me/notifications/${id}`, change),
        ).rejects.toBeTruthy()
    }

    await markNotificationsRead(ownerApi, [id])
    const stored = await find(ownerApi, id)
    expect(stored?.read).toBe(true)
    expect(stored?.user).toBe(owner.id)
    expect(stored?.url).toBe('/manage/reports')
    expect(stored?.type).toBe('report_filed')
    expect(await find(await apiAs(victim), id)).toBeUndefined()

    await deleteNotification(ownerApi, id)
})

test('only the recipient can see or touch a notification', async ({
    apiAs,
    createUser,
    testPrefix,
}) => {
    const owner = await createUser('user', 'a')
    const other = await createUser('admin', 'b')
    const id = createNotificationFor(
        owner.id,
        'report_filed',
        { snippet: testPrefix },
        '/manage/reports',
    )

    const anonymous = guestApi()
    await expect(listNotifications(anonymous)).rejects.toMatchObject({
        status: 401,
    })
    await expect(markNotificationsRead(anonymous, [id])).rejects.toMatchObject({
        status: 401,
    })
    await expect(deleteNotification(anonymous, id)).rejects.toMatchObject({
        status: 401,
    })

    const otherApi = await apiAs(other)
    expect(await find(otherApi, id)).toBeUndefined()
    await markNotificationsRead(otherApi, [id])
    await expect(deleteNotification(otherApi, id)).rejects.toMatchObject({
        status: 404,
    })

    const recipient = await apiAs(owner)
    expect((await find(recipient, id))?.read).toBe(false)

    await deleteNotification(recipient, id)
})
