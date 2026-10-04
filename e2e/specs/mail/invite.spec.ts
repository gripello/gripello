import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'
import { waitForMail, linkPath, mailbox } from '../../support/mail'
import { e2eGymId } from '../../support/seed'

const NEW_PASSWORD = 'E2eInvited!123'

test('a new member without an account sets a password from the mail and signs in', async ({
    adminPage: page,
    page: invited,
    root,
    testPrefix,
}) => {
    test.slow()
    const email = mailbox(testPrefix, 'invite')

    await gotoSettled(page, '/admin/users', /\/admin\/users/)
    await page.getByTestId('member-invite-open').click()
    await page.getByTestId('member-invite-firstname').fill('E2E')
    await page.getByTestId('member-invite-lastname').fill('Invited')
    await page.getByTestId('member-invite-email').fill(email)
    await page.getByTestId('member-invite-role').click()
    await page.getByRole('option', { name: 'routesetter', exact: true }).click()
    await page.getByTestId('member-invite-submit').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeHidden()

    const mail = await waitForMail(page, email, { subject: /invited/i })
    expect(mail.HTML).not.toContain('/_/#/')
    const path = linkPath(
        mail,
        /https?:\/\/[^"'\s]*\/auth\/confirm-password-reset\/[^"'\s]+/,
    )

    await gotoSettled(invited, path)
    await invited.getByTestId('password-new').fill(NEW_PASSWORD)
    await invited.getByTestId('password-confirm').fill(NEW_PASSWORD)
    await invited.getByTestId('confirm-reset-submit').click()
    await expect(invited.getByTestId('reset-done')).toBeVisible()

    await gotoSettled(invited, '/auth/login')
    await fillLogin(invited, email, NEW_PASSWORD)
    await invited.getByTestId('login-submit').click()
    await invited.waitForURL((url) => !url.pathname.startsWith('/auth/login'))

    const membership = await root.collection('memberships').getFirstListItem(
        root.filter('user.email = {:email} && gym = {:gym}', {
            email,
            gym: await e2eGymId(root),
        }),
        { expand: 'role', requestKey: null },
    )
    expect(membership.expand?.role?.name).toBe('routesetter')
})
