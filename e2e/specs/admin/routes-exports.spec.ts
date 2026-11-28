import fs from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

async function selectOwnRoutes(page: Page, testPrefix: string) {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(testPrefix)
    await expect(page.getByTestId('routes-row-name')).toHaveCount(2)
    await page.getByTestId('routes-select-all').click()
    await expect(page.getByTestId('routes-select-all')).toHaveText('2 selected')
}

test.beforeEach(async ({ createRoute }) => {
    await createRoute()
    await createRoute()
})

test.describe('exports', () => {
    test('exports selected routes as PDF', async ({
        adminPage: page,
        testPrefix,
    }) => {
        await selectOwnRoutes(page, testPrefix)
        await page.getByTestId('routes-export').click()
        await page.getByTestId('routes-export-pdf').click()
        const downloadPromise = page.waitForEvent('download')
        await page.getByTestId('export-confirm').click()
        const download = await downloadPromise
        const filePath = await download.path()
        expect(filePath).toBeTruthy()
        const bytes = fs.readFileSync(filePath!)
        expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    })

    test('exports selected routes as XLSX', async ({
        adminPage: page,
        testPrefix,
    }) => {
        await selectOwnRoutes(page, testPrefix)
        await page.getByTestId('routes-export').click()
        await page.getByTestId('routes-export-xlsx').click()
        const downloadPromise = page.waitForEvent('download')
        await page.getByTestId('export-confirm').click()
        const download = await downloadPromise
        const filePath = await download.path()
        expect(filePath).toBeTruthy()
        const bytes = fs.readFileSync(filePath!)
        expect(bytes.subarray(0, 4)).toEqual(
            Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        )
    })

    test('exports selected routes as JSON with real route content', async ({
        adminPage: page,
        testPrefix,
    }) => {
        await selectOwnRoutes(page, testPrefix)
        const downloadPromise = page.waitForEvent('download')
        await page.getByTestId('routes-export').click()
        await page.getByTestId('routes-export-json').click()
        const download = await downloadPromise
        const filePath = await download.path()
        expect(filePath).toBeTruthy()
        const parsed = JSON.parse(fs.readFileSync(filePath!, 'utf8'))
        expect(Array.isArray(parsed)).toBe(true)
        expect(parsed).toHaveLength(2)

        for (const route of parsed) {
            expect(route.id).toBeTruthy()
            expect(route.name).toBeTruthy()
            expect(Array.isArray(route.ratings)).toBe(true)
        }
        expect(
            parsed.every((r: { name: string }) =>
                r.name.startsWith(testPrefix),
            ),
        ).toBe(true)
    })

    test('exports only the selected columns, with QR images', async ({
        adminPage: page,
        testPrefix,
    }) => {
        await selectOwnRoutes(page, testPrefix)
        await page.getByTestId('routes-export').click()
        await page.getByTestId('routes-export-xlsx').click()

        await page.getByTestId('export-toggle-all').click()
        await page.getByTestId('export-toggle-all').click()
        await page
            .getByTestId('export-column-name')
            .locator('[role=checkbox]')
            .check()
        await page
            .getByTestId('export-column-qr')
            .locator('[role=checkbox]')
            .check()
        await page.getByTestId('export-move-up-qr').click()

        const downloadPromise = page.waitForEvent('download')
        await page.getByTestId('export-confirm').click()
        const download = await downloadPromise
        const filePath = await download.path()
        expect(filePath).toBeTruthy()

        const bytes = fs.readFileSync(filePath!)
        expect(bytes.subarray(0, 4)).toEqual(
            Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        )
        expect(bytes.includes(Buffer.from('xl/media/image1.png'))).toBe(true)
    })
})
