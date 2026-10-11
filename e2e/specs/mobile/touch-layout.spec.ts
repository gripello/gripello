import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { seedMap } from '../../support/map'

test.use({ viewport: { width: 360, height: 740 } })

test('route hero chips wrap instead of being clipped', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const seeded = await seedMap(adminApi, `${testPrefix}-long-location-name`, {
        routes: 1,
    })
    await gotoSettled(page, `/route?id=${seeded.routeIds[0]}`)
    const hero = page.getByTestId('route-hero')
    await expect(page.getByTestId('route-wall')).toBeVisible()

    await expect(async () => {
        const heroBox = (await hero.boundingBox())!
        const chipBoxes = await page
            .getByTestId('route-hero-chips')
            .locator(':scope > *')
            .evaluateAll((chips) =>
                chips.map((chip) => chip.getBoundingClientRect().toJSON()),
            )
        expect(chipBoxes.length).toBeGreaterThan(1)
        for (const box of chipBoxes)
            expect(box.right).toBeLessThanOrEqual(heroBox.x + heroBox.width)
        const rows = new Set(chipBoxes.map((box) => Math.round(box.top)))
        expect(rows.size).toBeGreaterThan(1)
    }).toPass()
})

test('icon buttons have a 44px touch target', async ({ page, route }) => {
    await gotoSettled(page, `/route?id=${route.id}`)
    const back = page.getByTestId('route-back')
    await expect(back).toBeVisible()

    await expect
        .poll(async () => {
            const box = (await back.boundingBox())!
            const centerX = box.x + box.width / 2
            const centerY = box.y + box.height / 2
            return page.evaluate(
                (points) =>
                    points.map(
                        ([x, y]) =>
                            !!document
                                .elementFromPoint(x!, y!)
                                ?.closest('[data-testid="route-back"]'),
                    ),
                [
                    [centerX - 21, centerY],
                    [centerX + 21, centerY],
                    [centerX, centerY - 21],
                    [centerX, centerY + 21],
                ],
            )
        })
        .toEqual([true, true, true, true])
})

test('settings asset actions are visible without hover', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/settings')
    await expect(page.getByTestId('settings-asset-actions-icon')).toHaveCount(0)
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('settings-asset-logo').click()
    await (
        await chooser
    ).setFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'base64',
        ),
    })
    const actions = page.getByTestId('settings-asset-actions-logo')
    await expect(actions).toBeVisible()
    await expect(actions).toHaveCSS('opacity', '1')
    await expect(
        actions.getByTestId('settings-asset-replace-logo'),
    ).toHaveJSProperty('tagName', 'BUTTON')
})

test('import preview renders as a list on phones', async ({
    adminPage: page,
    testPrefix,
}) => {
    const name = `${testPrefix}-import-preview`
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-more').click()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(
            JSON.stringify([{ name, difficulty: 8, anchor_point: 3 }]),
        ),
    })

    const list = page.getByTestId('import-route-list')
    await expect(list).toBeVisible()
    await expect(list).toContainText(name)
    await page.getByTestId('import-route-cancel').click()
    await expect(page.getByTestId('import-route-dialog')).toBeHidden()
})

test('import preview shows ratings when a route is expanded on phones', async ({
    adminPage: page,
    testPrefix,
}) => {
    const name = `${testPrefix}-import-ratings`
    const comment = `${testPrefix} imported comment`
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-more').click()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('routes-import-open').click()
    const chooser = await fileChooserPromise
    await chooser.setFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(
            JSON.stringify([
                {
                    name,
                    difficulty: 8,
                    anchor_point: 3,
                    ratings: [{ rating: 4, difficulty: 8, comment }],
                },
            ]),
        ),
    })

    const item = page.getByTestId('import-route-list-item').filter({
        hasText: name,
    })
    await expect(item).not.toContainText(comment)
    await item.getByText(name).click()
    await expect(item).toContainText(comment)
    await page.getByTestId('import-route-cancel').click()
})
