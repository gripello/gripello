import type { GymRecord, UserRecord } from '../../../types/models'
import {
    addMembership,
    createGym,
    deleteGym,
    findRole,
    listInvites,
    updateGym,
    type Api,
} from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function gymBySlug(api: Api, slug: string) {
    const { items } = await api.get<{ items: GymRecord[] }>('/gyms', {
        all: '1',
    })
    return items.find((gym) => gym.slug === slug) ?? null
}

test('platform admin creates, manages, deactivates and deletes a gym', async ({
    platformPage: page,
    api,
}) => {
    const slug = `e2e-pg-${Date.now()}`
    const adminEmail = `${slug}@gripello.test`
    try {
        await gotoSettled(page, '/platform/gyms')
        await page.getByTestId('platform-gym-create').click()
        await page.getByTestId('platform-gym-name').fill('E2E Platform Gym')
        await expect(page.getByTestId('platform-gym-slug')).toHaveValue(
            'e2e-platform-gym',
        )
        await page.getByTestId('platform-gym-slug').fill(slug)
        await page.getByTestId('platform-gym-admin-email').fill(adminEmail)
        await page.getByTestId('platform-gym-submit').click()
        await expect(page.getByTestId('platform-gym-dialog')).toBeHidden()

        const link = page.getByTestId(`platform-gym-link-${slug}`)
        await expect(link).toBeVisible()
        const gym = await gymBySlug(api, slug)
        const firstAdmin = (await listInvites(api, gym!.id)).find(
            (invite) => invite.email === adminEmail,
        )
        expect(firstAdmin?.role_name).toBe('admin')

        expect((await page.request.get(`/${slug}`)).status()).toBe(200)

        await page.getByTestId(`platform-gym-active-${slug}`).click()
        await page.getByTestId('confirm-dialog-confirm').click()
        await expect
            .poll(async () => (await gymBySlug(api, slug))?.active)
            .toBe(false)
        expect((await page.request.get(`/${slug}`)).status()).toBe(404)
        await page.getByTestId(`platform-gym-active-${slug}`).click()
        await expect
            .poll(async () => (await gymBySlug(api, slug))?.active)
            .toBe(true)

        await link.click()
        await page.waitForURL(`**/platform/gyms/${gym!.id}`)
        await expect(page.locator('h1')).toHaveText('E2E Platform Gym')

        await gotoSettled(page, `/platform/gyms/${gym!.id}?section=members`)
        await expect(
            page.getByTestId(`pending-invite-${adminEmail}`),
        ).toBeVisible()

        await gotoSettled(page, `/${slug}/admin/settings?section=organization`)
        await expect(page.getByTestId('settings-org-name')).toHaveValue(
            'E2E Platform Gym',
        )

        await gotoSettled(page, `/platform/gyms/${gym!.id}?section=danger`)
        await page.getByTestId('platform-gym-delete').click()
        await page.getByTestId('confirm-dialog-confirm').click()
        await page.waitForURL((url) => url.pathname === '/platform/gyms')
        await expect(page.getByTestId(`platform-gym-link-${slug}`)).toHaveCount(
            0,
        )
        await expect.poll(() => gymBySlug(api, slug)).toBeNull()
    } finally {
        const gym = await gymBySlug(api, slug)
        if (gym) await deleteGym(api, gym.id)
    }
})

test('renamed gym slugs redirect and stay taken until released', async ({
    platformPage: page,
    api,
}) => {
    const stamp = Date.now()
    const oldSlug = `e2e-old-${stamp}`
    const newSlug = `e2e-new-${stamp}`
    const gym = await createGym(api, {
        slug: oldSlug,
        name: `E2E Rename ${stamp}`,
        active: true,
    })
    const organization = `/platform/gyms/${gym.id}?section=organization`
    try {
        await gotoSettled(page, organization)
        await page.getByTestId('platform-gym-slug').fill(newSlug)
        await page.getByTestId('settings-save').click()
        await expect(page.getByTestId('settings-unsaved')).toBeHidden()
        await expect(
            page.getByTestId(`platform-gym-previous-${oldSlug}`),
        ).toBeVisible()

        const redirect = await page.request.get(`/${oldSlug}/routes?q=1`, {
            maxRedirects: 0,
        })
        expect(redirect.status()).toBe(301)
        expect(redirect.headers().location).toMatch(
            new RegExp(`/${newSlug}/routes\\?q=1$`),
        )

        await expect(
            createGym(api, { slug: oldSlug, name: 'E2E Taken', active: true }),
        ).rejects.toMatchObject({ status: 400 })

        await page.getByTestId(`platform-gym-release-${oldSlug}`).click()
        await expect(
            page.getByTestId(`platform-gym-previous-${oldSlug}`),
        ).toHaveCount(0)
        await page.getByTestId('settings-save').click()
        await expect(page.getByTestId('settings-unsaved')).toBeHidden()
        await expect
            .poll(
                async () =>
                    (await gymBySlug(api, newSlug))?.previous_slugs ?? null,
            )
            .toEqual([])

        await createGym(api, {
            slug: oldSlug,
            name: 'E2E Reused',
            active: true,
        })
    } finally {
        await deleteGym(api, gym.id).catch(() => {})
        const reused = await gymBySlug(api, oldSlug)
        if (reused) await deleteGym(api, reused.id)
    }
})

test('the platform overview counts gyms and lists platform admins', async ({
    platformPage: page,
    api,
}) => {
    await gotoSettled(page, '/platform')
    await expect(
        page.getByTestId('platform-stat-gyms').getByTestId('stats-card-value'),
    ).toHaveText(/^[1-9]\d*$/)
    await expect(
        page
            .locator('[data-testid="gym-switcher"]:visible')
            .getByTestId('gym-switcher-platform'),
    ).toBeVisible()
    await expect(page.getByTestId('gym-switcher-name')).toHaveCount(0)
    const { items: admins } = await api.get<{ items: UserRecord[] }>(
        '/platform/users',
        { filter: 'platform_admins', limit: 0 },
    )
    for (const admin of admins) {
        await expect(
            page.getByTestId(`platform-admin-${admin.id}`),
        ).toBeVisible()
    }
})

test('inactive gyms drop out of every gym picker', async ({
    platformPage: adminPage,
    api,
    createUser,
    pageAs,
}) => {
    const slug = `e2e-inactive-${Date.now()}`
    const gym = await createGym(api, {
        slug,
        name: 'E2E Inactive Gym',
        active: true,
    })
    try {
        const role = await findRole(api, 'admin', gym.id)
        const member = await createUser('user', 'inactive-member')
        await addMembership(api, member.id, role.id, gym.id)
        const page = await pageAs(member)

        const expectListed = async (count: number) => {
            await gotoSettled(page, '/')
            await expect(page.getByTestId(`landing-gym-${slug}`)).toHaveCount(
                count,
            )
            await page.locator('[data-testid="gym-switcher"]:visible').click()
            await expect(page.getByTestId('gym-switcher-all')).toBeVisible()
            await expect(
                page.getByTestId(`gym-switcher-item-${slug}`),
            ).toHaveCount(count)
            await page.keyboard.press('Escape')
            await gotoSettled(page, '/account')
            await expect(page.getByTestId(`me-gym-${slug}`)).toHaveCount(count)
        }

        await expectListed(1)

        await gotoSettled(adminPage, '/platform/gyms')
        await adminPage.getByTestId(`platform-gym-active-${slug}`).click()
        await adminPage.getByTestId('confirm-dialog-confirm').click()
        await expect
            .poll(async () => (await gymBySlug(api, slug))?.active)
            .toBe(false)

        await expectListed(0)
    } finally {
        await deleteGym(api, gym.id).catch(() => {})
    }
})

test('climbers and gym admins are sent away from the platform page', async ({
    userPage,
    adminPage,
}) => {
    for (const page of [userPage, adminPage]) {
        await gotoSettled(page, '/platform/gyms', /^https?:\/\/[^/]+\/$/)
        await expect(page.getByTestId('platform-gym-table')).toHaveCount(0)
    }
})

test('a failed first-admin invite still opens the new gym', async ({
    platformPage: page,
    api,
}) => {
    const slug = `e2e-invite-${Date.now()}`
    try {
        await page.route('**/api/gyms/*/members', (request) =>
            request.fulfill({ status: 500, json: { message: 'down' } }),
        )
        await gotoSettled(page, '/platform/gyms')
        await page.getByTestId('platform-gym-create').click()
        await page.getByTestId('platform-gym-name').fill('E2E Invite Gym')
        await page.getByTestId('platform-gym-slug').fill(slug)
        await page
            .getByTestId('platform-gym-admin-email')
            .fill(`${slug}@gripello.test`)
        await page.getByTestId('platform-gym-submit').click()

        await expect.poll(() => gymBySlug(api, slug)).not.toBeNull()
        const gym = await gymBySlug(api, slug)
        await page.waitForURL(`**/platform/gyms/${gym!.id}`)
        await expect(page.getByTestId('platform-gym-dialog')).toHaveCount(0)
        await expect(page.getByTestId('platform-gym-open')).toBeVisible()

        await updateGym(api, gym!.id, { active: false })
        await gotoSettled(page, `/platform/gyms/${gym!.id}`)
        await expect(page.getByTestId('platform-gym-open')).toHaveCount(0)
    } finally {
        const gym = await gymBySlug(api, slug)
        if (gym) await deleteGym(api, gym.id)
    }
})
