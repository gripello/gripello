import { test, expect } from '../../support/fixtures'
import { fillLogin } from '../../support/auth'
import { gotoSettled } from '../../support/nav'
import { waitForMail, linkPath, mailbox } from '../../support/mail'
import { getPlatformUser, guestApi, setUserFlags } from '../../support/api'

test('the verification mail links into the app, not the admin panel', async ({
    page,
    api,
    createUser,
}) => {
    const { email, id } = await createUser('user', 'verify')
    setUserFlags(id, { verified: false })
    await guestApi().post('/auth/verification/request', { email })

    const mail = await waitForMail(page, email, { subject: /verify/i })
    expect(mail.HTML).not.toContain('/_/#/')

    const path = linkPath(
        mail,
        /https?:\/\/[^"'\s]*\/auth\/confirm-verification\/[^"'\s]+/,
    )
    await gotoSettled(page, path)
    await expect(page.getByTestId('verify-done')).toBeVisible()

    const after = await getPlatformUser(api, id)
    expect(after.verified).toBe(true)
})

test('an email change confirms from the new address and then signs in', async ({
    page,
    createUser,
    testPrefix,
}) => {
    test.slow()
    const { email, password: PASSWORD } = await createUser('user', 'change')
    const newEmail = mailbox(testPrefix, 'changed')

    await gotoSettled(page, '/auth/login')
    await fillLogin(page, email, PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'))

    await gotoSettled(page, '/account/settings')
    await page.getByTestId('profile-email').fill(newEmail)
    await page.getByTestId('profile-save').click()

    const mail = await waitForMail(page, newEmail, { subject: /email/i })
    expect(mail.HTML).not.toContain('/_/#/')

    const path = linkPath(
        mail,
        /https?:\/\/[^"'\s]*\/auth\/confirm-email-change\/[^"'\s]+/,
    )
    await gotoSettled(page, path)
    await page.getByTestId('email-change-password').fill(PASSWORD)
    await page.getByTestId('email-change-submit').click()
    await expect(page.getByTestId('email-change-done')).toBeVisible()

    await gotoSettled(page, '/auth/login')
    await fillLogin(page, newEmail, PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/login'))
})
