import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { mailbox, waitForMail } from '../../support/mail'
import { uiaa } from '../../support/seed'

test.use({ locale: 'fr-FR' })

test('the notifier gets the receipt in the language they reported in', async ({
    page,
    root,
    route,
    testPrefix,
}) => {
    const notifier = mailbox(testPrefix, 'fr')
    await root.collection('ratings').create({
        route_id: route.id,
        rating: 2,
        ...uiaa('5'),
        comment: `${testPrefix}-reportable`,
    })

    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('comment-card-report').first().click()
    await page.getByTestId('report-form-reason').click()
    await page.getByRole('option').first().click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page
        .getByTestId('report-form-explanation')
        .first()
        .fill(`${testPrefix} commentaire abusif`)
    await page.getByTestId('report-form-name').first().fill('E2E')
    await page.getByTestId('report-form-email').first().fill(notifier)
    await page.getByTestId('report-form-goodfaith').check()
    await page.getByTestId('report-form-submit').click()
    await expect(page.getByTestId('report-form-dialog')).toBeHidden()

    const receipt = await waitForMail(page, notifier, {
        subject: /Nous avons reçu votre signalement/,
    })
    expect(receipt.HTML).toContain('lang="fr"')
})
