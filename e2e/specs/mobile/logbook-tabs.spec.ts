import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { signInAs } from '../../support/auth'
import { apiAs, createTick } from '../../support/api'
import { translate } from '../../support/i18n'
import { uiaa } from '../../support/seed'

for (const locale of ['en-US', 'de-DE', 'nl-NL', 'fr-FR', 'es-ES']) {
    const language = locale.slice(0, 2)

    test.describe(locale, () => {
        test.use({ locale, viewport: { width: 360, height: 740 } })

        test('logbook tabs share one height and carry the count on the icon', async ({
            page,
            testPrefix,
            createUser,
            createRoute,
        }) => {
            const climber = await createUser('user', `tabs-${language}`)
            const project = await createRoute({
                name: `${testPrefix}-tabs-${language}`,
                ...uiaa('8'),
                screw_date: '2026-09-01',
            })
            await createTick(await apiAs(climber), {
                route: project.id,
                type: 'attempt',
                attempts: 3,
                date: new Date().toISOString().slice(0, 10),
            })

            await signInAs(page, climber.email, climber.password)
            await gotoSettled(page, '/logbook')

            const tabs = page.getByTestId('logbook-tabs').getByRole('tab')
            await expect(tabs).toHaveCount(5)
            const projects = tabs.filter({
                has: page.getByTestId('logbook-tab-projects'),
            })
            await expect(projects).toHaveAccessibleName(
                `${translate(language, 'ticks.tabs.projects')}, 1`,
            )

            const boxes = await tabs.evaluateAll((elements) =>
                elements.map((tab) => {
                    const box = tab.getBoundingClientRect()
                    const label = tab
                        .querySelector('[data-slot="label"]')!
                        .getBoundingClientRect()
                    return {
                        height: box.height,
                        left: box.left,
                        right: box.right,
                        labelFits:
                            label.left >= box.left - 1 &&
                            label.right <= box.right + 1,
                    }
                }),
            )
            for (const box of boxes) {
                expect(box.height).toBeCloseTo(boxes[0]!.height, 0)
                expect(box.height).toBeGreaterThanOrEqual(44)
                expect(box.labelFits).toBe(true)
                expect(box.left).toBeGreaterThanOrEqual(0)
                expect(box.right).toBeLessThanOrEqual(360)
            }

            const icon = (await projects
                .locator('[data-tab-icon]')
                .boundingBox())!
            const badge = page.getByTestId('logbook-projects-count')
            await expect(badge).toHaveText('1')
            const count = (await badge.boundingBox())!
            const centerX = count.x + count.width / 2
            const centerY = count.y + count.height / 2
            expect(centerX).toBeGreaterThan(icon.x + icon.width / 2)
            expect(centerX).toBeLessThanOrEqual(icon.x + icon.width + 4)
            expect(centerY).toBeLessThan(icon.y + icon.height / 2)
            expect(centerY).toBeGreaterThanOrEqual(icon.y - 4)

            const sideways = await page.evaluate(
                () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
            )
            expect(sideways).toBeLessThanOrEqual(1)
        })
    })
}
