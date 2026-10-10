import { test, expect } from '../../support/fixtures'
import { E2E_GYM_SLUG, uiaa } from '../../support/seed'
import { authHeader, gotoSettled, gymPath } from '../../support/nav'

const ADMIN_PATHS = [
    '/manage/routes',
    '/manage/analytics',
    '/manage/comments',
    '/admin/users',
    '/admin/settings',
    '/manage/inventory',
]

test.describe('unauthenticated guard', () => {
    for (const path of ADMIN_PATHS) {
        test(`${path} redirects to login`, async ({ page }) => {
            await gotoSettled(page, path)
            await page.waitForURL(
                (url) =>
                    url.pathname === '/auth/login' &&
                    url.searchParams.get('redirect') === gymPath(path),
            )
        })
    }
})

test.describe('anonymous guard', () => {
    test('the routes API refuses a create with no session', async ({
        page,
    }) => {
        const res = await page.request.post(
            `/api/gyms/${E2E_GYM_SLUG}/routes`,
            {
                data: { name: 'should-not-be-created', ...uiaa('1') },
            },
        )
        expect(res.status()).toBeGreaterThanOrEqual(400)
    })
})

test.describe('routesetter guard', () => {
    test('is redirected away from /admin/users', async ({
        setterPage: page,
    }) => {
        await gotoSettled(page, '/admin/users')
        await page.waitForURL((url) => !url.pathname.endsWith('/admin/users'))
    })

    test('is redirected away from /admin/settings', async ({
        setterPage: page,
    }) => {
        await gotoSettled(page, '/admin/settings')
        await page.waitForURL(
            (url) => !url.pathname.endsWith('/admin/settings'),
        )
    })

    test('the members API refuses an invite from a routesetter session', async ({
        setterPage: page,
    }) => {
        await gotoSettled(page, '/manage/routes', '**/manage/routes')
        const res = await page.request.post(
            `/api/gyms/${E2E_GYM_SLUG}/members`,
            {
                headers: await authHeader(page),
                data: {
                    email: 'should-not-be-created@gripello.test',
                    role: 'admin',
                },
            },
        )
        expect(res.status()).toBeGreaterThanOrEqual(400)
    })

    test('can reach /manage/routes', async ({ setterPage: page }) => {
        await gotoSettled(page, '/manage/routes', '**/manage/routes')
        await expect(page.getByTestId('routes-create-open')).toBeVisible()
    })
})

test.describe('admin guard', () => {
    for (const path of ADMIN_PATHS) {
        test(`can reach ${path}`, async ({ adminPage: page }) => {
            await gotoSettled(page, path)
            await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/')))
        })
    }
})
