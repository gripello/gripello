import type { GymRecord } from '../../../types/models'
import {
    addMembership,
    createGym,
    deleteGym,
    findRole,
    updateGym,
    type Api,
} from '../../support/api'
import { test, expect } from '../../support/fixtures'
import { linkPath, mailbox, waitForMail } from '../../support/mail'
import { gotoSettled, gotoSubscribed } from '../../support/nav'

const OWNER_PASSWORD = 'E2eOwner!12345'

async function gymBySlug(api: Api, slug: string) {
    const { items } = await api.get<{ items: GymRecord[] }>('/gyms', {
        all: '1',
    })
    return items.find((gym) => gym.slug === slug) ?? null
}

test('an onboarding link sets up a trial gym whose owner joins as admin', async ({
    platformPage,
    page: owner,
    api,
    testPrefix,
}) => {
    test.slow()
    const email = mailbox(testPrefix, 'owner')
    const slug = `${testPrefix}-gym`
    try {
        await gotoSettled(platformPage, '/platform/gyms')
        await platformPage.getByTestId('platform-gym-onboarding-create').click()
        await platformPage
            .getByTestId('platform-gym-onboarding-email')
            .fill(email)
        await platformPage.getByTestId('platform-gym-onboarding-submit').click()
        await expect(
            platformPage.getByTestId(`platform-gym-onboarding-${email}`),
        ).toBeVisible()

        const mail = await waitForMail(platformPage, email, {
            subject: /set up your gym/i,
        })
        const path = linkPath(mail, /https?:\/\/[^"'\s]*\/auth\/gym\/[0-9a-f]+/)

        await gotoSettled(owner, path)
        await expect(owner.getByTestId('gym-onboarding-form')).toBeVisible()
        await owner.getByTestId('gym-onboarding-name').fill('E2E Trial Gym')
        await expect(owner.getByTestId('gym-onboarding-slug')).toHaveValue(
            'e2e-trial-gym',
        )
        await owner.getByTestId('gym-onboarding-slug').fill(slug)
        await owner.getByTestId('gym-onboarding-submit').click()

        await owner.waitForURL(/\/auth\/invite\//)
        await expect(owner.getByTestId('invite-register')).toBeVisible()
        await owner.getByTestId('password-new').fill(OWNER_PASSWORD)
        await owner.getByTestId('password-confirm').fill(OWNER_PASSWORD)
        await owner.getByTestId('invite-register-submit').click()
        await owner.waitForURL((url) => url.pathname === `/${slug}`)

        const gym = await gymBySlug(api, slug)
        expect(gym?.active).toBe(true)
        expect(gym?.trial_ends_at).toBeTruthy()
        await expect(owner.getByTestId('nav-gym-trial')).toContainText('30')
        await expect(owner.getByTestId('nav-staff-tools')).toBeVisible()

        await gotoSettled(owner, path)
        await expect(owner.getByTestId('gym-onboarding-invalid')).toBeVisible()
        await gotoSettled(platformPage, '/platform/gyms')
        await expect(
            platformPage.getByTestId(`platform-gym-onboarding-${email}`),
        ).toHaveCount(0)
        await expect(
            platformPage.getByTestId(`platform-gym-trial-${slug}`),
        ).toBeVisible()
    } finally {
        const gym = await gymBySlug(api, slug)
        if (gym) await deleteGym(api, gym.id)
    }
})

test('an ended trial leaves staff read-only until the gym is converted, live', async ({
    platformPage,
    pageAs,
    api,
    createUser,
    testPrefix,
}) => {
    test.slow()
    const slug = `${testPrefix}-ro`
    const created = await createGym(api, {
        slug,
        name: 'E2E Read-only Gym',
        active: true,
        trial_ends_at: new Date(Date.now() + 20 * 86400_000).toISOString(),
    })
    try {
        const admin = await createUser('user', 'ro-admin')
        const adminRole = await findRole(api, 'admin', created.id)
        await addMembership(api, admin.id, adminRole.id, created.id)

        const staff = await pageAs(admin)
        await gotoSubscribed(
            staff,
            `/${slug}/manage/analytics`,
            `gym:${created.id}`,
        )
        await expect(staff.getByTestId('nav-link-manage-routes')).toBeVisible()
        await expect(staff.getByTestId('nav-gym-trial')).toBeVisible()

        await updateGym(api, created.id, {
            trial_ends_at: new Date(Date.now() - 60_000).toISOString(),
        })
        await expect(staff.getByTestId('nav-gym-trial')).toContainText(
            /read-only/i,
        )
        await expect(staff.getByTestId('nav-link-manage-routes')).toHaveCount(0)
        const blocked = await staff.request.patch(`/api/gyms/${created.id}`, {
            data: { name: 'Changed' },
        })
        expect(blocked.status()).toBe(403)

        await gotoSettled(platformPage, `/platform/gyms/${created.id}`)
        await expect(
            platformPage.getByTestId('platform-gym-trial'),
        ).toBeVisible()
        await platformPage.getByTestId('platform-gym-trial-convert').click()
        await platformPage.getByTestId('confirm-dialog-confirm').click()
        await expect(
            platformPage.getByTestId('platform-gym-trial'),
        ).toHaveCount(0)

        await expect(staff.getByTestId('nav-gym-trial')).toHaveCount(0)
        await expect(staff.getByTestId('nav-link-manage-routes')).toBeVisible()
    } finally {
        await deleteGym(api, created.id)
    }
})
