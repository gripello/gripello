import type { Locator } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const themeColor = 'meta[name="theme-color"]'

test('the page extends under the iOS safe areas', async ({ page }) => {
    await gotoSettled(page, '/map')
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
        'content',
        /viewport-fit=cover/,
    )
})

test.describe('light theme', () => {
    test.use({ colorScheme: 'light' })

    test('tints the status bar with the light app bar', async ({ page }) => {
        await gotoSettled(page, '/map')
        await expect(page.locator(themeColor)).toHaveCount(1)
        await expect(page.locator(themeColor)).toHaveAttribute(
            'content',
            /^#FFFFFF$/i,
        )
    })
})

test('the error page still tints the status bar', async ({ page }) => {
    await gotoSettled(page, '/this-page-does-not-exist')
    await expect(page.getByTestId('error-page')).toBeVisible()
    await expect(page.locator(themeColor)).toHaveCount(1)
})

test.describe('dark theme', () => {
    test.use({ colorScheme: 'dark' })

    test('the offline page tints the status bar dark', async ({ page }) => {
        await page.goto('/offline.html')
        await expect(
            page.locator(
                'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]',
            ),
        ).toHaveAttribute('content', /^#0d1117$/i)
    })

    test('tints the status bar with the dark app bar', async ({ page }) => {
        await gotoSettled(page, '/map')
        await expect(page.locator(themeColor)).toHaveAttribute(
            'content',
            /^#161b22$/i,
        )
    })
})

async function coveredBySafeAreaPadding(sheet: Locator) {
    return sheet.evaluate((element) => {
        const covers = (rules: CSSRuleList): boolean =>
            [...rules].some(
                (rule) =>
                    (rule instanceof CSSStyleRule &&
                        element.matches(rule.selectorText) &&
                        rule.style.paddingBottom.includes(
                            'safe-area-inset-bottom',
                        )) ||
                    ('cssRules' in rule &&
                        covers((rule as CSSGroupingRule).cssRules)),
            )
        return [...document.styleSheets].some((styleSheet) => {
            try {
                return covers(styleSheet.cssRules)
            } catch {
                return false
            }
        })
    })
}

test('the filter sheet keeps its actions above the home indicator', async ({
    page,
}) => {
    await gotoSettled(page, '/routes')
    await page.getByTestId('filter-open-sheet').click()
    const sheet = page.getByTestId('filter-sheet')
    await expect(sheet).toBeVisible()
    await expect.poll(() => coveredBySafeAreaPadding(sheet)).toBe(true)
})

test('dialog sheets keep their actions above the home indicator', async ({
    page,
    route,
}) => {
    await gotoSettled(page, `/route?id=${route.id}`)
    await page.getByTestId('review-open-cta').click()
    const sheet = page.getByTestId('review-form-dialog')
    await expect(sheet).toBeVisible()
    await expect.poll(() => coveredBySafeAreaPadding(sheet)).toBe(true)
})

for (const path of ['/scan', '/map']) {
    test(`${path} fits the screen above the home indicator`, async ({
        page,
    }) => {
        await gotoSettled(page, path)
        await page.addStyleTag({
            content: ':root { --app-bottom-inset: 34px !important; }',
        })
        await expect
            .poll(() =>
                page.evaluate(
                    () =>
                        document.scrollingElement!.scrollHeight -
                        window.innerHeight,
                ),
            )
            .toBeLessThanOrEqual(0)
    })
}
