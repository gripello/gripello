import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { createCompetition, e2eGymId, type Api } from '../../support/api'
import { projectLanguage } from '../../support/i18n'

type Viewer = 'guest' | 'climber' | 'staff' | 'platform'

const PAGES: Record<string, [Viewer, string]> = {
    'index.vue': ['guest', '/'],
    'imprint.vue': ['guest', '/imprint'],
    'privacy/index.vue': ['guest', '/privacy'],
    'privacy/account-deletion.vue': ['guest', '/privacy/account-deletion'],
    'route.vue': ['guest', '/route?id={route}'],
    'scan.vue': ['guest', '/scan'],
    'auth/login.vue': ['guest', '/auth/login'],
    'auth/confirm-email-change/[token].vue': [
        'guest',
        '/auth/confirm-email-change/e2e-invalid',
    ],
    'auth/confirm-password-reset/[token].vue': [
        'guest',
        '/auth/confirm-password-reset/e2e-invalid',
    ],
    'auth/confirm-verification/[token].vue': [
        'guest',
        '/auth/confirm-verification/e2e-invalid',
    ],
    'auth/gym/[token].vue': ['guest', '/auth/gym/e2e-invalid'],
    'account/export/[token].vue': ['guest', '/account/export/e2e-invalid'],
    'account/export/index.vue': ['climber', '/account/export'],
    'auth/invite/[token].vue': ['guest', '/auth/invite/e2e-invalid'],
    '[gym]/index.vue': ['guest', gymPath('/')],
    '[gym]/routes.vue': ['guest', gymPath('/routes')],
    '[gym]/route.vue': ['guest', `${gymPath('/route')}?id={route}`],
    '[gym]/map.vue': ['guest', gymPath('/map')],
    '[gym]/info.vue': ['guest', gymPath('/info')],
    '[gym]/imprint.vue': ['guest', gymPath('/imprint')],
    '[gym]/privacy.vue': ['guest', gymPath('/privacy')],
    '[gym]/tv.vue': ['guest', gymPath('/tv')],
    '[gym]/leaderboard/index.vue': ['guest', gymPath('/leaderboard')],
    '[gym]/leaderboard/tv.vue': ['guest', gymPath('/leaderboard/tv')],
    '[gym]/competitions/index.vue': ['guest', gymPath('/competitions')],
    '[gym]/competitions/[id]/index.vue': [
        'guest',
        gymPath('/competitions/{competition}'),
    ],
    '[gym]/competitions/[id]/rules.vue': [
        'guest',
        gymPath('/competitions/{competition}/rules'),
    ],
    '[gym]/competitions/[id]/tv.vue': [
        'guest',
        gymPath('/competitions/{competition}/tv'),
    ],
    'logbook.vue': ['climber', '/logbook'],
    'friends.vue': ['climber', '/friends'],
    'climber.vue': ['climber', '/climber?id={climber}'],
    'account/index.vue': ['climber', '/account'],
    'account/settings.vue': ['climber', '/account/settings?tab=security'],
    'account/activity.vue': ['climber', '/account/activity'],
    '[gym]/feed.vue': ['climber', gymPath('/feed')],
    '[gym]/manage/index.vue': ['staff', gymPath('/manage')],
    '[gym]/manage/analytics.vue': ['staff', gymPath('/manage/analytics')],
    '[gym]/manage/comments.vue': ['staff', gymPath('/manage/comments')],
    '[gym]/manage/competitions/index.vue': [
        'staff',
        gymPath('/manage/competitions'),
    ],
    '[gym]/manage/competitions/[id]/index.vue': [
        'staff',
        gymPath('/manage/competitions/{competition}'),
    ],
    '[gym]/manage/competitions/[id]/judge.vue': [
        'staff',
        gymPath('/manage/competitions/{competition}/judge'),
    ],
    '[gym]/manage/inventory.vue': ['staff', gymPath('/manage/inventory')],
    '[gym]/manage/judge.vue': ['staff', gymPath('/manage/judge')],
    '[gym]/manage/map.vue': ['staff', gymPath('/manage/map')],
    '[gym]/manage/moderation.vue': ['staff', gymPath('/manage/moderation')],
    '[gym]/manage/routes.vue': ['staff', gymPath('/manage/routes')],
    '[gym]/manage/tasks.vue': ['staff', gymPath('/manage/tasks')],
    '[gym]/admin/map.vue': ['staff', gymPath('/admin/map')],
    '[gym]/admin/settings.vue': ['staff', gymPath('/admin/settings')],
    '[gym]/admin/users.vue': ['staff', gymPath('/admin/users')],
    'platform/index.vue': ['platform', '/platform'],
    'platform/backups.vue': ['platform', '/platform/backups'],
    'platform/gyms/index.vue': ['platform', '/platform/gyms'],
    'platform/gyms/[id].vue': ['platform', '/platform/gyms/{gym}'],
    'platform/logs.vue': ['platform', '/platform/logs'],
    'platform/moderation.vue': ['platform', '/platform/moderation'],
    'platform/more.vue': ['platform', '/platform/more'],
    'platform/settings.vue': ['platform', '/platform/settings'],
    'platform/users.vue': ['platform', '/platform/users'],
}

const PAGES_DIR = path.join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'app',
    'pages',
)

test('every page file is checked at phone width', () => {
    const files = readdirSync(PAGES_DIR, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.vue'))
        .map((file) => file.split(path.sep).join('/'))
        .sort()
    expect(files).toEqual(Object.keys(PAGES).sort())
})

async function expectPhoneFit(page: Page, target: string, language: string) {
    await gotoSettled(page, target)
    await expect(page.locator('html')).toHaveAttribute(
        'lang',
        new RegExp(`^${language}`),
    )
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(
        () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
    )
    expect(overflow, `${target} scrolls sideways`).toBeLessThanOrEqual(1)

    const smallIconButtons = await page.evaluate(() => {
        function hitArea(element: HTMLElement) {
            const box = element.getBoundingClientRect()
            const extended = getComputedStyle(element, '::before')
            if (extended.position !== 'absolute') return box
            return {
                width: Math.max(box.width, parseFloat(extended.width) || 0),
                height: Math.max(box.height, parseFloat(extended.height) || 0),
            }
        }
        return [...document.querySelectorAll<HTMLElement>('button, a[href]')]
            .filter((element) => {
                if (element.innerText.trim()) return false
                if (/^(checkbox|switch|radio)$/.test(element.role ?? ''))
                    return false
                if (
                    !element.querySelector('.iconify, svg, [class*="i-lucide"]')
                )
                    return false
                const box = element.getBoundingClientRect()
                if (!box.width || !box.height) return false
                if (getComputedStyle(element).visibility === 'hidden')
                    return false
                const hit = hitArea(element)
                return hit.width < 43.5 || hit.height < 43.5
            })
            .map((element) => {
                const box = hitArea(element)
                const name =
                    element.dataset.testid ||
                    element.getAttribute('aria-label') ||
                    element.outerHTML.slice(0, 80)
                return `${name} (${Math.round(box.width)}x${Math.round(box.height)})`
            })
    })
    expect(smallIconButtons, `${target} icon buttons under 44px`).toEqual([])
}

interface Deps {
    createRoute: () => Promise<{ id: string }>
    createUser: (role?: string, label?: string) => Promise<{ id: string }>
    adminApi: Api
    testPrefix: string
    workerLocation: { id: string }
}

async function resolve(pattern: string, deps: Deps) {
    let target = pattern
    if (target.includes('{route}'))
        target = target.replace('{route}', (await deps.createRoute()).id)
    if (target.includes('{climber}'))
        target = target.replace(
            '{climber}',
            (await deps.createUser('user', 'fit')).id,
        )
    if (target.includes('{gym}'))
        target = target.replace('{gym}', await e2eGymId())
    if (target.includes('{competition}')) {
        const competition = await createCompetition(deps.adminApi, {
            name: `${deps.testPrefix} Wettkampf`,
            location: deps.workerLocation.id,
            status: 'open',
            discipline: 'boulder',
            scoring_format: 'dynamic',
            starts_at: new Date(Date.now() - 3600_000).toISOString(),
            ends_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        target = target.replaceAll('{competition}', competition.id)
    }
    return target
}

for (const [file, [viewer, pattern]] of Object.entries(PAGES)) {
    const title = `${file} fits a German phone (${viewer})`
    const check = async (page: Page, deps: Deps, language: string) =>
        expectPhoneFit(page, await resolve(pattern, deps), language)
    if (viewer === 'guest')
        test(
            title,
            async (
                {
                    page,
                    createRoute,
                    createUser,
                    adminApi,
                    testPrefix,
                    workerLocation,
                },
                testInfo,
            ) =>
                check(
                    page,
                    {
                        createRoute,
                        createUser,
                        adminApi,
                        testPrefix,
                        workerLocation,
                    },
                    projectLanguage(testInfo),
                ),
        )
    if (viewer === 'climber')
        test(
            title,
            async (
                {
                    userPage,
                    createRoute,
                    createUser,
                    adminApi,
                    testPrefix,
                    workerLocation,
                },
                testInfo,
            ) =>
                check(
                    userPage,
                    {
                        createRoute,
                        createUser,
                        adminApi,
                        testPrefix,
                        workerLocation,
                    },
                    projectLanguage(testInfo),
                ),
        )
    if (viewer === 'staff')
        test(
            title,
            async (
                {
                    adminPage,
                    createRoute,
                    createUser,
                    adminApi,
                    testPrefix,
                    workerLocation,
                },
                testInfo,
            ) =>
                check(
                    adminPage,
                    {
                        createRoute,
                        createUser,
                        adminApi,
                        testPrefix,
                        workerLocation,
                    },
                    projectLanguage(testInfo),
                ),
        )
    if (viewer === 'platform')
        test(
            title,
            async (
                {
                    platformPage,
                    createRoute,
                    createUser,
                    adminApi,
                    testPrefix,
                    workerLocation,
                },
                testInfo,
            ) =>
                check(
                    platformPage,
                    {
                        createRoute,
                        createUser,
                        adminApi,
                        testPrefix,
                        workerLocation,
                    },
                    projectLanguage(testInfo),
                ),
        )
}
