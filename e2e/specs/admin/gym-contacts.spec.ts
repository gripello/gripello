import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { getGym, updateGym } from '../../support/api'

const noSidewaysScroll = () =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth

test('phone: the imprint links the general contact, back returns to it, appeals follow the privacy contact', async ({
    adminPage: page,
    adminApi,
}) => {
    const before = await getGym(adminApi, E2E_GYM_SLUG)
    try {
        await updateGym(adminApi, E2E_GYM_SLUG, {
            contact_email: 'front-desk-with-a-long-name@e2e-gym.example',
            legal_phone: '+49 69 123456789',
            contacts: [],
        })
        await page.setViewportSize({ width: 360, height: 740 })

        await gotoSettled(page, '/admin/settings')
        await page.getByRole('link', { name: 'Legal notice' }).first().click()
        await expect(page).toHaveURL(/section=legal/)
        const contactRow = page.getByTestId('settings-legal-contact')
        await expect(contactRow).toContainText('+49 69 123456789')
        expect(await page.evaluate(noSidewaysScroll)).toBe(true)

        await contactRow.click()
        await expect(page).toHaveURL(/section=contacts/)
        await expect(
            page.getByTestId('settings-contact-general-uses'),
        ).toContainText('Appeals')

        await page.getByTestId('settings-contact-add').click()
        await page.getByTestId('contact-dialog-kind-privacy').click()
        await page
            .getByTestId('contact-dialog-email')
            .fill('a..b@e2e-gym.example')
        await expect(page.getByTestId('contact-dialog-submit')).toBeDisabled()
        await page
            .getByTestId('contact-dialog-email')
            .fill('dpo@e2e-gym.example')
        await page.getByTestId('contact-dialog-submit').click()
        await expect(page.getByTestId('settings-contact-0-uses')).toContainText(
            'Appeals',
        )
        await expect(
            page.getByTestId('settings-contact-general-uses'),
        ).not.toContainText('Appeals')
        expect(await page.evaluate(noSidewaysScroll)).toBe(true)

        await page.getByTestId('settings-save').click()
        await expect(page.getByTestId('settings-save')).toBeHidden()
        expect((await getGym(adminApi, E2E_GYM_SLUG)).contacts).toEqual([
            { kind: 'privacy', email: 'dpo@e2e-gym.example' },
        ])

        await page.getByRole('button', { name: 'Go back' }).click()
        await expect(page).toHaveURL(/section=legal/)

        await gotoSettled(page, gymPath('/info'))
        await expect(page.getByTestId('gym-info-email')).toContainText(
            'front-desk-with-a-long-name',
        )
        expect(await page.evaluate(noSidewaysScroll)).toBe(true)
    } finally {
        await updateGym(adminApi, E2E_GYM_SLUG, {
            contact_email: before.contact_email,
            legal_phone: before.legal_phone,
            contacts: before.contacts ?? [],
        })
    }
})
