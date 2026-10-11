import { Workbook } from '@cj-tech-master/excelts'
import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'
import { LOCATIONS } from '../../support/seed'
import { e2eGymId } from '../../support/api'

test('xlsx export formats dates in the requested locale and prints the location name', async ({
    adminPage: page,
    createRoute,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes')
    const headers = await authHeader(page)
    const { id: routeId } = await createRoute({
        screw_date: '2026-03-14',
    })

    const response = await page.request.post('/api/ui/xlsx', {
        headers,
        data: {
            gym: await e2eGymId(),
            ids: [routeId],
            locale: 'de',
            columns: ['location', 'screw_date'],
            labels: { location: 'Standort' },
        },
    })
    expect(response.ok()).toBe(true)

    const workbook = new Workbook()
    await workbook.xlsx.load(await response.body())
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(1).values).toEqual([undefined, 'Standort', 'Set on'])
    expect(sheet.getRow(2).values).toEqual([
        undefined,
        workerLocation.name,
        '14.3.2026',
    ])
})

test('json download is named in the ui language and carries location names', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-select-all').click()

    const jsonDownload = page.waitForEvent('download')
    await page.getByTestId('routes-export-json').click()
    const download = await jsonDownload
    expect(download.suggestedFilename()).toMatch(/^climbing-routes.*\.json$/)

    const fs = await import('node:fs')
    const parsed = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    expect(
        parsed.some((route: { location: string }) =>
            LOCATIONS.includes(route.location as (typeof LOCATIONS)[number]),
        ),
    ).toBe(true)
})
