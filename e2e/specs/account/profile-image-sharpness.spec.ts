import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { uploadMyImage } from '../../support/api'

test.use({ deviceScaleFactor: 2 })

function gradientJpeg(page: Page, width: number, height: number) {
    return page.evaluate(
        ([w, h]) => {
            const canvas = document.createElement('canvas')
            canvas.width = w!
            canvas.height = h!
            const context = canvas.getContext('2d')!
            const gradient = context.createLinearGradient(0, 0, w!, h!)
            gradient.addColorStop(0, '#1e5ac8')
            gradient.addColorStop(1, '#e8a33d')
            context.fillStyle = gradient
            context.fillRect(0, 0, w!, h!)
            return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!
        },
        [width, height],
    )
}

function filePixelsPerCssPixel(page: Page, testId: string) {
    return page.getByTestId(testId).evaluate(async (img: HTMLImageElement) => {
        const file = new Image()
        file.src = img.currentSrc || img.src
        await file.decode()
        return Math.min(
            file.naturalWidth / img.clientWidth,
            file.naturalHeight / img.clientHeight,
        )
    })
}

test('the profile avatar and banner stay sharp on dense screens', async ({
    apiAs,
    createUser,
    pageAs,
}) => {
    const user = await createUser('user')
    const page = await pageAs(user)
    const api = await apiAs(user)
    await uploadMyImage(api, 'avatar', {
        name: 'avatar.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(await gradientJpeg(page, 1200, 1200), 'base64'),
    })
    await uploadMyImage(api, 'banner', {
        name: 'banner.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(await gradientJpeg(page, 3000, 750), 'base64'),
    })

    await gotoSettled(page, '/account')
    await expect(page.getByTestId('climber-banner-image')).toBeVisible()
    await expect(page.getByTestId('me-avatar')).toBeVisible()

    await expect
        .poll(() => filePixelsPerCssPixel(page, 'climber-banner-image'))
        .toBeGreaterThanOrEqual(1.9)
    await expect
        .poll(() => filePixelsPerCssPixel(page, 'me-avatar'))
        .toBeGreaterThanOrEqual(1.9)
})
