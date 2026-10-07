import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

const PAGES = [
    '/',
    '/manage/routes',
    '/admin/users',
    '/manage/comments',
    '/manage/analytics',
    '/admin/settings',
    '/manage/inventory',
    '/manage/moderation',
    '/account/activity',
    '/logbook',
]

for (const path of PAGES) {
    test(`${path} renders exactly one top-level heading`, async ({
        adminPage: page,
    }) => {
        await gotoSettled(page, path)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.locator('h1')).not.toBeEmpty()
    })
}

test('every icon-only button exposes an accessible name', async ({
    adminPage: page,
}) => {
    for (const path of [
        '/manage/routes',
        '/admin/users',
        '/manage/comments',
        '/manage/moderation',
        '/account/activity',
        '/logbook',
    ]) {
        await gotoSettled(page, path)
        const unnamed = await page
            .locator('button.icon-btn:visible')
            .evaluateAll((buttons) =>
                buttons
                    .filter(
                        (b) =>
                            !b.getAttribute('aria-label')?.trim() &&
                            !b.textContent?.trim(),
                    )
                    .map((b) => b.outerHTML.slice(0, 120)),
            )
        expect(unnamed, `unnamed icon buttons on ${path}`).toEqual([])
    }
})

test('dialogs share the same shell: role, title and escape-to-close', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')

    await page.getByTestId('routes-create-open').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(/\S/)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    await gotoSettled(page, '/admin/users')
    await page.getByTestId('member-invite-open').click()
    await expect(page.getByTestId('member-invite-dialog')).toBeVisible()
    await expect(page.getByTestId('member-invite-cancel')).toBeVisible()
})

test('an empty result set renders the shared empty state as a real card', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/users')
    await page.getByTestId('filter-search').fill('zzz-no-such-user-zzz')
    const empty = page.getByTestId('empty-state')
    await expect(empty).toBeVisible()
    await expect(empty).toHaveCSS('display', 'block')
    await expect(empty).not.toHaveCSS('border-top-left-radius', '0px')
    await expect(empty).not.toHaveCSS('border-top-width', '0px')

    const icon = empty.getByTestId('empty-state-icon')
    await expect
        .poll(async () => {
            const [iconBox, emptyBox] = await Promise.all([
                icon.boundingBox(),
                empty.boundingBox(),
            ])
            return Math.abs(
                iconBox!.x +
                    iconBox!.width / 2 -
                    (emptyBox!.x + emptyBox!.width / 2),
            )
        })
        .toBeLessThan(2)
})

test('dialog confirm buttons keep their fill inside v-card-actions', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('routes-create-open').click()

    await expect(page.getByTestId('route-form-submit')).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
    )
    await expect(page.getByTestId('route-form-cancel')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
    )
})
