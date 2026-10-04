import type PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function gymBySlug(root: PocketBase, slug: string) {
    return root
        .collection('gyms')
        .getFirstListItem(root.filter('slug = {:slug}', { slug }), {
            requestKey: null,
        })
        .catch(() => null)
}

test('platform admin creates, manages, deactivates and deletes a gym', async ({
    platformPage: page,
    root,
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
        const gym = await gymBySlug(root, slug)
        const firstAdmin = await root
            .collection('memberships')
            .getFirstListItem(
                root.filter('gym = {:gym} && user.email = {:email}', {
                    gym: gym!.id,
                    email: adminEmail,
                }),
                { expand: 'role', requestKey: null },
            )
        expect(firstAdmin.expand?.role?.name).toBe('admin')

        expect((await page.request.get(`/${slug}`)).status()).toBe(200)

        await page.getByTestId(`platform-gym-active-${slug}`).click()
        await expect
            .poll(async () => (await gymBySlug(root, slug))?.active)
            .toBe(false)
        expect((await page.request.get(`/${slug}`)).status()).toBe(404)
        await page.getByTestId(`platform-gym-active-${slug}`).click()
        await expect
            .poll(async () => (await gymBySlug(root, slug))?.active)
            .toBe(true)

        await link.click()
        await page.waitForURL(`**/platform/gyms/${gym!.id}`)
        await expect(page.locator('h1')).toHaveText('E2E Platform Gym')

        await gotoSettled(page, `/platform/gyms/${gym!.id}?section=members`)
        await expect(
            page.getByTestId(`member-card-${firstAdmin.user}`),
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
        await expect.poll(() => gymBySlug(root, slug)).toBeNull()
    } finally {
        const gym = await gymBySlug(root, slug)
        if (gym) await root.collection('gyms').delete(gym.id)
        const invited = await root
            .collection('users')
            .getFirstListItem(
                root.filter('email = {:email}', { email: adminEmail }),
                { requestKey: null },
            )
            .catch(() => null)
        if (invited) await root.collection('users').delete(invited.id)
    }
})

test('renamed gym slugs redirect and stay taken until released', async ({
    platformPage: page,
    root,
}) => {
    const stamp = Date.now()
    const oldSlug = `e2e-old-${stamp}`
    const newSlug = `e2e-new-${stamp}`
    const gym = await root
        .collection('gyms')
        .create({ slug: oldSlug, name: `E2E Rename ${stamp}`, active: true })
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
            root
                .collection('gyms')
                .create({ slug: oldSlug, name: 'E2E Taken', active: true }),
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
                    (await gymBySlug(root, newSlug))?.previous_slugs ?? null,
            )
            .toEqual([])

        await root
            .collection('gyms')
            .create({ slug: oldSlug, name: 'E2E Reused', active: true })
    } finally {
        await root
            .collection('gyms')
            .delete(gym.id)
            .catch(() => {})
        const reused = await gymBySlug(root, oldSlug)
        if (reused) await root.collection('gyms').delete(reused.id)
    }
})

test('the platform overview counts gyms and lists platform admins', async ({
    platformPage: page,
    root,
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
    const admins = await root.collection('users').getFullList({
        filter: 'platform_admin = true',
        requestKey: null,
    })
    for (const admin of admins) {
        await expect(
            page.getByTestId(`platform-admin-${admin.id}`),
        ).toBeVisible()
    }
})

test('inactive gyms drop out of every gym picker', async ({
    platformPage: adminPage,
    root,
    createUser,
    pageAs,
}) => {
    const slug = `e2e-inactive-${Date.now()}`
    const gym = await root
        .collection('gyms')
        .create({ slug, name: 'E2E Inactive Gym', active: true })
    try {
        const role = await root
            .collection('roles')
            .getFirstListItem(
                root.filter('gym = {:gym} && name = "admin"', { gym: gym.id }),
                { requestKey: null },
            )
        const member = await createUser('user', 'inactive-member')
        await root
            .collection('memberships')
            .create({ user: member.id, gym: gym.id, role: role.id })
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
        await expect
            .poll(async () => (await gymBySlug(root, slug))?.active)
            .toBe(false)

        await expectListed(0)
    } finally {
        await root
            .collection('gyms')
            .delete(gym.id)
            .catch(() => {})
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
    root,
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

        await expect.poll(() => gymBySlug(root, slug)).not.toBeNull()
        const gym = await gymBySlug(root, slug)
        await page.waitForURL(`**/platform/gyms/${gym!.id}`)
        await expect(page.getByTestId('platform-gym-dialog')).toHaveCount(0)
        await expect(page.getByTestId('platform-gym-open')).toBeVisible()

        await root.collection('gyms').update(gym!.id, { active: false })
        await gotoSettled(page, `/platform/gyms/${gym!.id}`)
        await expect(page.getByTestId('platform-gym-open')).toHaveCount(0)
    } finally {
        const gym = await gymBySlug(root, slug)
        if (gym) await root.collection('gyms').delete(gym.id)
    }
})
