import { test, expect } from '../../support/fixtures'
import {
    createCompetition,
    createLocation,
    getGym,
    updateCompetition,
    updateGym,
} from '../../support/api'
import { gotoSettled } from '../../support/nav'

test('the TV screen shows the gym announcement in both orientations', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    const text = `${testPrefix} comp night Friday`
    await updateGym(adminApi, 'e2e', {
        tv_settings: {
            screens: [
                {
                    id: 'main',
                    slides: ['announcements'],
                    seconds: 8,
                    takeover: false,
                },
            ],
            announcements: [{ text }],
        },
    })
    try {
        for (const size of [
            { width: 1920, height: 1080 },
            { width: 1080, height: 1920 },
        ]) {
            await page.setViewportSize(size)
            await gotoSettled(page, '/e2e/tv')
            // competitions of parallel tests may add promo slides, so wait for the rotation
            await expect(page.getByTestId('tv-announcement')).toContainText(
                text,
                { timeout: 60_000 },
            )
            const rootSize = await page.evaluate(() =>
                parseFloat(getComputedStyle(document.documentElement).fontSize),
            )
            expect(rootSize).toBeCloseTo(16, 0)
        }
    } finally {
        await updateGym(adminApi, 'e2e', { tv_settings: null })
    }
})

test('a running competition takes over the TV screen unless turned off', async ({
    page,
    adminApi,
    workerLocation,
    testPrefix,
}) => {
    const hour = 60 * 60 * 1000
    await createCompetition(adminApi, {
        name: `${testPrefix} TV Jam`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() - hour).toISOString(),
        ends_at: new Date(Date.now() + hour).toISOString(),
        live_ranking: true,
        freeze_minutes: 0,
    })

    await updateGym(adminApi, 'e2e', {
        tv_settings: {
            screens: [{ id: 'main' }, { id: 'quiet', takeover: false }],
        },
    })
    try {
        await gotoSettled(page, '/e2e/tv')
        await expect(
            page.getByTestId('gym-tv').getByTestId('competition-tv'),
        ).toBeVisible()

        await gotoSettled(page, '/e2e/tv?screen=quiet')
        await expect(page.getByTestId('competition-tv')).toHaveCount(0)
        await expect(page.locator('[data-testid^="tv-slide-"]')).toBeVisible()
    } finally {
        await updateGym(adminApi, 'e2e', { tv_settings: null })
    }
})

test('staff set up the screen in the gym settings', async ({
    adminPage: page,
    adminApi,
    testPrefix,
}) => {
    try {
        await gotoSettled(page, '/admin/settings?section=tv')
        await page.getByTestId('settings-tv-screen-add').click()
        await expect(page.getByTestId('settings-tv-screen-1')).toBeVisible()
        await page.getByTestId('settings-tv-screen-name').fill('Bar')
        await expect(page.getByTestId('settings-tv-screen-1')).toHaveText('Bar')
        await page.getByTestId('settings-tv-slide-leaderboard').click()
        await page.getByTestId('settings-tv-seconds-20').click()
        await expect(
            page.getByTestId('settings-tv-seconds-custom'),
        ).toHaveValue('20')
        await page.getByTestId('settings-tv-seconds-custom').fill('45')
        await page.getByTestId('settings-tv-announcement-add').click()
        await page
            .getByTestId('settings-tv-announcement-text')
            .fill(`  ${testPrefix} new set  `)
        await page.getByTestId('settings-tv-takeover').click()
        await expect(page.getByTestId('settings-tv-url')).toHaveText(
            /\/e2e\/tv\?screen=[a-z0-9]{8}$/,
        )
        await page.getByTestId('settings-save').click()
        await expect(page.getByTestId('settings-save')).toBeHidden()

        const gym = await getGym(adminApi, 'e2e')
        expect(gym.tv_settings).toEqual({
            screens: [
                expect.objectContaining({ id: 'main', seconds: 12 }),
                {
                    id: expect.stringMatching(/^[a-z0-9]{8}$/),
                    name: 'Bar',
                    slides: ['new_routes', 'resets', 'info', 'announcements'],
                    seconds: 45,
                    location: '',
                    takeover: false,
                },
            ],
            announcements: [{ text: `${testPrefix} new set` }],
        })
    } finally {
        await updateGym(adminApi, 'e2e', { tv_settings: null })
    }
})

test('the TV of a draft competition is not found for guests', async ({
    page,
    adminApi,
    workerLocation,
    testPrefix,
}) => {
    const day = 24 * 60 * 60 * 1000
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} TV Draft`,
        location: workerLocation.id,
        status: 'draft',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() + day).toISOString(),
        ends_at: new Date(Date.now() + 2 * day).toISOString(),
    })

    const response = await page.goto(`/e2e/competitions/${competition.id}/tv`)
    expect(response?.status()).toBe(404)
})

test('a screen follows a location created while it is running', async ({
    page,
    adminApi,
    testPrefix,
}) => {
    test.setTimeout(120_000)
    await updateGym(adminApi, 'e2e', {
        tv_settings: { screens: [{ id: 'hall', takeover: false }] },
    })
    try {
        await gotoSettled(page, '/e2e/tv?screen=hall')
        const name = `${testPrefix} TV Hall`
        const location = await createLocation(adminApi, name)
        await updateGym(adminApi, 'e2e', {
            tv_settings: {
                screens: [
                    { id: 'hall', takeover: false, location: location.id },
                ],
            },
        })
        // settings arrive with the next one-minute poll
        await expect(page.getByTestId('tv-eyebrow')).toContainText(name, {
            timeout: 90_000,
        })
    } finally {
        await updateGym(adminApi, 'e2e', { tv_settings: null })
    }
})

test('the competition TV follows a changed end time live', async ({
    page,
    adminApi,
    workerLocation,
    testPrefix,
}) => {
    const hour = 60 * 60 * 1000
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} TV Moved`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() - hour).toISOString(),
        ends_at: new Date(Date.now() + hour).toISOString(),
        live_ranking: true,
        freeze_minutes: 0,
    })

    await gotoSettled(page, `/e2e/competitions/${competition.id}/tv`)
    const countdown = page.getByTestId('competition-tv-countdown')
    await expect(countdown).toContainText(/ 0:5\d:/)

    await updateCompetition(adminApi, competition.id, {
        ends_at: new Date(Date.now() + 3 * hour).toISOString(),
    })
    await expect(countdown).toContainText(/ 2:5\d:/)
})
