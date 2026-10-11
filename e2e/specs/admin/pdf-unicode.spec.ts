import { test, expect } from '../../support/fixtures'
import { authHeader, gotoSettled } from '../../support/nav'
import { uiaa } from '../../support/seed'
import { e2eGymId } from '../../support/api'

test('pdf labels embed a unicode font for cyrillic and turkish text', async ({
    adminPage: page,
    createRoute,
    testPrefix,
}) => {
    const route = await createRoute({
        name: `${testPrefix}-Скала İzmir`,
        ...uiaa('6'),
        anchor_point: 12,
        creator: ['Рутсеттер'],
        color: '#ff0000',
    })
    await gotoSettled(page, '/manage/routes')
    const headers = await authHeader(page)

    const response = await page.request.post('/api/ui/pdf', {
        headers,
        data: {
            ids: [route.id],
            gym: await e2eGymId(),
            labels: { anchor: 'Станция' },
        },
    })
    expect(response.ok()).toBe(true)
    const pdf = (await response.body()).toString('latin1')

    expect(pdf.startsWith('%PDF')).toBe(true)
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Roboto-Regular/)
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Roboto-Bold/)
    expect(pdf).not.toContain('/BaseFont /Helvetica')
})
