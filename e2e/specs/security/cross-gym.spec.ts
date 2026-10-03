import { randomUUID } from 'node:crypto'
import type { RecordModel } from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'

test('staff of one gym cannot manage another gym', async ({
    setterPage: page,
    root,
}) => {
    const slug = `e2e-other-${randomUUID().slice(0, 8)}`
    const otherGym = await root
        .collection('gyms')
        .create({ slug, name: 'Other E2E Gym', active: true })
    try {
        const location = await root
            .collection('locations')
            .create({ name: 'Other Hall', gym: otherGym.id })
        const foreignRoute: RecordModel = await root
            .collection('routes')
            .create({
                name: 'Foreign route',
                ...uiaa('5'),
                anchor_point: 1,
                location: location.id,
                type: 'Route',
                color: '#F44336',
                creator: ['E2E'],
                screw_date: new Date().toISOString().slice(0, 10),
            })

        await gotoSettled(page, `/${slug}/routes`)
        const headers = await authHeader(page)

        const created = await page.request.post(
            '/api/collections/routes/records',
            {
                headers,
                data: {
                    name: 'Smuggled route',
                    ...uiaa('5'),
                    anchor_point: 2,
                    location: location.id,
                    type: 'Route',
                    color: '#F44336',
                    creator: ['E2E'],
                },
            },
        )
        expect([400, 403]).toContain(created.status())

        const updated = await page.request.patch(
            `/api/collections/routes/records/${foreignRoute.id}`,
            { headers, data: { name: 'Hijacked' } },
        )
        expect([400, 403, 404]).toContain(updated.status())
        expect(
            (await root.collection('routes').getOne(foreignRoute.id)).name,
        ).toBe('Foreign route')

        await expect(page.getByTestId('nav-link-routes')).toBeVisible()
        await expect(page.getByTestId('nav-group-manage')).toHaveCount(0)
        await expect(page.getByTestId('nav-link-manage-routes')).toHaveCount(0)

        await gotoSettled(page, `/${slug}/manage/routes`)
        await page.waitForURL((url) => url.pathname === '/')
    } finally {
        await root.collection('gyms').delete(otherGym.id)
    }
})
