import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

test('a mat can be drawn on a phone and finished with the button', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, testPrefix, { routes: 1 })
    try {
        await gotoSettled(page, `/admin/map?location=${seeded.locationId}`)
        const shapes = page.getByTestId('map-editor-shape-item')
        const before = await shapes.count()

        await page.getByTestId('map-editor-tool-mat').tap()
        const canvas = (await page
            .getByTestId('map-editor-canvas')
            .boundingBox())!
        for (const [dx, dy] of [
            [0.3, 0.25],
            [0.6, 0.25],
            [0.6, 0.4],
        ])
            await page.touchscreen.tap(
                canvas.x + canvas.width * dx!,
                canvas.y + canvas.height * dy!,
            )

        await page.getByTestId('map-editor-finish').tap()
        await expect(page.getByTestId('map-editor-finish')).toHaveCount(0)
        await expect(shapes).toHaveCount(before + 1)
        await expect(page.getByTestId('map-editor-save')).toBeEnabled()
    } finally {
        await seeded.cleanup()
    }
})
