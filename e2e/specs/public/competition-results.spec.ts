import { test, expect } from '../../support/fixtures'
import {
    createCompetition,
    createCompetitionCategory,
    createCompetitionEntry,
    createCompetitionRoute,
    putCompetitionScores,
    updateCompetition,
} from '../../support/api'
import { gotoSettled } from '../../support/nav'

test('live results rank climbers, hide names on request and freeze before the end', async ({
    page,
    setterPage,
    adminApi,
    workerLocation,
    createRoute,
    createUser,
    testPrefix,
}) => {
    const hour = 60 * 60 * 1000
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} Results Jam`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() - hour).toISOString(),
        ends_at: new Date(Date.now() + hour).toISOString(),
        live_ranking: true,
        freeze_minutes: 0,
    })
    const category = await createCompetitionCategory(adminApi, competition.id, {
        name: 'Open',
    })
    const compRoutes = []
    for (const number of [1, 2]) {
        const boulder = await createRoute({
            type: 'Boulder',
            name: `${testPrefix} Results ${number}`,
        })
        compRoutes.push(
            await createCompetitionRoute(adminApi, competition.id, {
                route: boulder.id,
                number,
                zone: true,
            }),
        )
    }
    const enter = async (label: string, hidden: boolean) => {
        const user = await createUser('user', label)
        return createCompetitionEntry(adminApi, competition.id, {
            user: user.id,
            category: category.id,
            display_name: `${testPrefix} ${label}`,
            birth_year: 1990,
            hidden,
        })
    }
    const anna = await enter('anna', false)
    const ben = await enter('ben', true)
    const top = (entry: string, compRoute: string) => ({
        entry,
        comp_route: compRoute,
        attempts: 1,
        top_attempt: 1,
    })
    await putCompetitionScores(adminApi, competition.id, [
        top(anna.id, compRoutes[0]!.id),
        top(anna.id, compRoutes[1]!.id),
        top(ben.id, compRoutes[0]!.id),
    ])

    await gotoSettled(page, `/competitions/${competition.id}`, /\/competition/)
    const standings = page.getByTestId('competition-standings')
    await expect(standings.getByTestId(`standing-rank-${anna.bib}`)).toHaveText(
        '1',
    )
    await expect(
        standings.getByTestId(`standing-points-${anna.bib}`),
    ).toHaveText('1,500')
    await expect(standings.getByTestId(`standing-${ben.bib}`)).toContainText(
        'Hidden climber',
    )
    await expect(
        standings.getByTestId(`standing-${ben.bib}`),
    ).not.toContainText(`${testPrefix} ben`)

    await page.goto(`/competitions/${competition.id}/tv`)
    await expect(
        page.getByTestId('competition-tv').getByTestId(`standing-${anna.bib}`),
    ).toContainText(`${testPrefix} anna`)

    await updateCompetition(adminApi, competition.id, { freeze_minutes: 120 })
    await expect
        .poll(
            async () => {
                await page.goto(`/competitions/${competition.id}`)
                return page
                    .getByTestId('competition-standings-frozen')
                    .isVisible()
            },
            { timeout: 20_000, intervals: [2_000] },
        )
        .toBe(true)

    await gotoSettled(
        setterPage,
        `/manage/competitions/${competition.id}`,
        /\/manage\/competition/,
    )
    await setterPage.getByRole('tab', { name: 'Results' }).click()
    await expect(setterPage.getByTestId(`standing-${ben.bib}`)).toContainText(
        `${testPrefix} ben`,
    )
})
