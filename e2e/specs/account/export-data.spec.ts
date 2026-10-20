import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { linkPath, waitForMail } from '../../support/mail'

function zipEntries(zip: Buffer): string[] {
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    let offset = zip.readUInt32LE(end + 16)
    const names: string[] = []
    for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
        const nameLength = zip.readUInt16LE(offset + 28)
        const extraLength = zip.readUInt16LE(offset + 30)
        const commentLength = zip.readUInt16LE(offset + 32)
        names.push(zip.toString('utf8', offset + 46, offset + 46 + nameLength))
        offset += 46 + nameLength + extraLength + commentLength
    }
    return names
}

test('mails a link to the data export and downloads it', async ({
    createUser,
    pageAs,
}) => {
    const user = await createUser()
    const page = await pageAs(user)
    await gotoSettled(page, '/account/settings?tab=security')
    const exportButton = page.getByTestId('account-export')
    await exportButton.click()
    await expect(exportButton).toBeDisabled()

    const mail = await waitForMail(page, user.email, {
        subject: /data is ready/i,
        timeoutMs: 30_000,
    })
    const path = linkPath(mail, /https?:\/\/[^"'\s<]*\/account\/export\/[\w-]+/)

    await gotoSettled(page, path)
    const link = page.getByTestId('account-export-download')
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^\/api\/account\/export\/[\w-]+$/)

    const response = await page.context().browser()!.newContext()
    const guest = await response.request.get(new URL(href!, page.url()).href)
    expect(guest.status()).toBe(200)
    expect(guest.headers()['content-disposition']).toMatch(
        /^attachment; filename="gripello-data-\d{4}-\d{2}-\d{2}\.zip"$/,
    )
    const entries = zipEntries(await guest.body())
    for (const name of ['profile.json', 'ticks.json', 'logbook.csv']) {
        expect(entries).toContain(name)
    }
    await response.close()

    await gotoSettled(page, '/account/export')
    await expect(page.getByTestId('account-export-download')).toHaveAttribute(
        'href',
        '/api/me/export/file',
    )
    const own = await page.request.get(
        new URL('/api/me/export/file', page.url()).href,
    )
    expect(own.status()).toBe(200)

    await gotoSettled(page, '/account/export/not-a-real-token')
    await expect(page.getByTestId('account-export-again')).toBeVisible()
})
