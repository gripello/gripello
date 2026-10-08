import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('crops a new avatar before it is saved', async ({
    createUser,
    pageAs,
    root,
}) => {
    const climber = await createUser()
    const page = await pageAs(climber)
    await gotoSettled(page, '/account/settings')

    const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 800
        canvas.height = 400
        const context = canvas.getContext('2d')!
        context.fillStyle = '#e33'
        context.fillRect(0, 0, 400, 400)
        context.fillStyle = '#33e'
        context.fillRect(400, 0, 400, 400)
        return canvas.toDataURL('image/png').split(',')[1]!
    })
    await page.getByTestId('profile-avatar-input').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
    })

    const frame = page.getByTestId('image-crop-frame')
    await expect(frame).toBeVisible()
    const box = (await frame.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width, box.y + box.height / 2, {
        steps: 5,
    })
    await page.mouse.up()
    await page.getByTestId('image-crop-save').click()
    await expect(page.getByTestId('image-crop-dialog')).toBeHidden()

    const saved = page.waitForResponse(
        (res) =>
            res.request().method() === 'PATCH' &&
            res.url().includes('/api/collections/users/records/'),
    )
    await page.getByTestId('profile-save').click()
    expect((await saved).ok()).toBe(true)

    const record = await root.collection('users').getOne(climber.id)
    expect(record.avatar).toMatch(/\.png$/)
    const file = await page.request.get(
        root.files.getURL(record, record.avatar),
    )
    const bytes = await file.body()
    expect(bytes.readUInt32BE(16)).toBe(bytes.readUInt32BE(20))
})
