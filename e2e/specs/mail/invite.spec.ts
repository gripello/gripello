import type { Page } from '@playwright/test'
import type PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { waitForMail, linkPath, mailbox } from '../../support/mail'
import { e2eGymId } from '../../support/seed'

const NEW_PASSWORD = 'E2eInvited!123'

async function inviteByMail(page: Page, email: string) {
    await gotoSettled(page, '/admin/users', /\/admin\/users/)
    await page.getByTestId('member-invite-open').click()
    await page.getByTestId('member-invite-firstname').fill('E2E')
    await page.getByTestId('member-invite-lastname').fill('Invited')
    await page.getByTestId('member-invite-email').fill(email)
    await page.getByTestId('member-invite-role').click()
    await page.getByRole('option', { name: 'routesetter', exact: true }).click()
    await page.getByTestId('member-invite-submit').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeHidden()
    await expect(page.getByTestId(`pending-invite-${email}`)).toBeVisible()

    const mail = await waitForMail(page, email, { subject: /invited/i })
    expect(mail.HTML).not.toContain('/_/#/')
    return linkPath(mail, /https?:\/\/[^"'\s]*\/auth\/invite\/[^"'\s]+/)
}

async function roleOf(root: PocketBase, email: string) {
    const membership = await root
        .collection('memberships')
        .getFirstListItem(
            root.filter('user.email = {:email} && gym = {:gym}', {
                email,
                gym: await e2eGymId(root),
            }),
            { expand: 'role', requestKey: null },
        )
        .catch(() => null)
    return membership?.expand?.role?.name ?? null
}

test('a new address creates its account from the invitation', async ({
    adminPage: page,
    page: invited,
    root,
    testPrefix,
}) => {
    test.slow()
    const email = mailbox(testPrefix, 'invite')
    const path = await inviteByMail(page, email)
    expect(await roleOf(root, email)).toBeNull()

    await gotoSettled(invited, path)
    await expect(invited.getByTestId('invite-register')).toBeVisible()
    await expect(invited.getByTestId('invite-firstname')).toHaveValue('E2E')
    await invited.getByTestId('password-new').fill(NEW_PASSWORD)
    await invited.getByTestId('password-confirm').fill(NEW_PASSWORD)
    await invited.getByTestId('invite-register-submit').click()
    await invited.waitForURL((url) => url.pathname === '/e2e')

    expect(await roleOf(root, email)).toBe('routesetter')
    await gotoSettled(page, '/admin/users', /\/admin\/users/)
    await expect(page.getByTestId(`pending-invite-${email}`)).toHaveCount(0)

    await gotoSettled(invited, path)
    await expect(invited.getByTestId('invite-invalid')).toBeVisible()
})

test('an existing account joins only after accepting', async ({
    adminPage: page,
    root,
    createUser,
    pageAs,
}) => {
    test.slow()
    const climber = await createUser('user', 'invitee')
    const path = await inviteByMail(page, climber.email)
    expect(await roleOf(root, climber.email)).toBeNull()

    const climberPage = await pageAs(climber)
    await gotoSettled(climberPage, path)
    await climberPage.getByTestId('invite-join').click()
    await climberPage.waitForURL((url) => url.pathname === '/e2e')
    expect(await roleOf(root, climber.email)).toBe('routesetter')
})
