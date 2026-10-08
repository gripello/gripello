import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('dragging the banner crop moves the image, not the sheet', async ({
    createUser,
    pageAs,
}) => {
    const page = await pageAs(await createUser())
    await gotoSettled(page, '/account/settings')

    const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 1200
        canvas.height = 900
        const context = canvas.getContext('2d')!
        context.fillStyle = '#3a3'
        context.fillRect(0, 0, 1200, 900)
        return canvas.toDataURL('image/png').split(',')[1]!
    })
    await page.getByTestId('profile-banner-input').setInputFiles({
        name: 'banner.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
    })

    const dialog = page.getByTestId('image-crop-dialog')
    const stage = page.getByTestId('image-crop-stage')
    await expect(stage).toBeVisible()
    const image = stage.locator('img')
    await expect(image).toBeVisible()
    const sheetBefore = (await dialog.boundingBox())!
    const imageBefore = await image.evaluate(
        (element) => element.style.transform,
    )

    const box = (await stage.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height, {
        steps: 8,
    })
    await page.mouse.up()

    await expect(dialog).toBeVisible()
    expect((await dialog.boundingBox())!.y).toBeCloseTo(sheetBefore.y, 0)
    expect(await image.evaluate((element) => element.style.transform)).not.toBe(
        imageBefore,
    )
})
