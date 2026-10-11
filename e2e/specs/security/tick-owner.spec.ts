import { test, expect } from '../../support/fixtures'
import {
    createTick,
    deleteTick,
    guestApi,
    listOwnTicks,
    updateRoute,
    updateTick,
} from '../../support/api'
import { uiaa } from '../../support/seed'
import type { TickRecord } from '../../../types/models'

const DAY = '2026-09-26T12:00:00.000Z'

test('ticks stay private to their owner and keep the grade they were logged at', async ({
    adminApi,
    apiAs,
    createUser,
    createRoute,
}) => {
    const owner = await createUser('user', 'a')
    const other = await createUser('user', 'b')
    const route = await createRoute({
        ...uiaa('7-'),
        screw_date: '2026-09-01',
    })

    const ownerApi = await apiAs(owner)
    const otherApi = await apiAs(other)

    const tick = await ownerApi.post<TickRecord>('/me/ticks', {
        route: route.id,
        type: 'flash',
        attempts: 7,
        date: DAY,
        grade: '11',
    })
    expect(tick.grade).toBe('7-')
    expect(tick.grade_system).toBe('uiaa')
    expect(tick.attempts).toBe(1)

    await expect(
        createTick(ownerApi, {
            route: route.id,
            type: 'top',
            date: '2099-01-01T12:00:00.000Z',
        }),
    ).rejects.toMatchObject({ status: 400 })

    expect(await ownerApi.get<string[]>('/me/ticks/sends')).toContain(route.id)
    expect(await otherApi.get<string[]>('/me/ticks/sends')).not.toContain(
        route.id,
    )

    await updateRoute(adminApi, route.id, uiaa('7'))
    expect(
        (await listOwnTicks(ownerApi)).find((item) => item.id === tick.id)
            ?.grade,
    ).toBe('7-')

    await expect(
        otherApi.post('/me/ticks', {
            user: owner.id,
            route: route.id,
            type: 'top',
            attempts: 1,
            date: DAY,
        }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
        updateTick(otherApi, tick.id, { note: 'mine now' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(deleteTick(otherApi, tick.id)).rejects.toMatchObject({
        status: 404,
    })
    expect((await listOwnTicks(otherApi)).map((item) => item.id)).not.toContain(
        tick.id,
    )
    await expect(listOwnTicks(guestApi())).rejects.toMatchObject({
        status: 401,
    })

    for (const change of [
        { user: other.id },
        { grade: '11' },
        { route: 'another-route' },
    ]) {
        await expect(
            updateTick(ownerApi, tick.id, change),
        ).rejects.toMatchObject({ status: 400 })
    }
})
