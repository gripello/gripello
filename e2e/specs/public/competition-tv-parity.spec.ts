import { test, expect } from '../../support/fixtures'
import { putCompetitionScores } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import { BOULDER, openBoulderCompetition } from '../../support/competitions'

test('the TV shows the same fractional dynamic points as the results page', async ({
    page,
    adminApi,
    workerLocation,
    createRoute,
    createUser,
    testPrefix,
}) => {
    const climbers = []
    for (const label of ['ada', 'bo', 'cy'])
        climbers.push({
            user: await createUser('user', `parity-${label}`),
            name: `${testPrefix} ${label}`,
        })
    const { competition, compRoutes, entries } = await openBoulderCompetition(
        adminApi,
        {
            name: `${testPrefix} Parity Jam`,
            location: workerLocation.id,
            routes: [
                await createRoute({ name: `${testPrefix} P1`, ...BOULDER }),
                await createRoute({ name: `${testPrefix} P2`, ...BOULDER }),
            ],
            climbers,
            competition: { freeze_minutes: 0 },
        },
    )
    const [first, second] = compRoutes
    const top = (entry: { id: string }, compRoute: { id: string }) => ({
        entry: entry.id,
        comp_route: compRoute.id,
        attempts: 1,
        top_attempt: 1,
    })
    await putCompetitionScores(adminApi, competition.id, [
        ...entries.map((entry) => top(entry, first!)),
        top(entries[0]!, second!),
        top(entries[1]!, second!),
    ])

    await gotoSettled(page, `/competitions/${competition.id}`, /\/competition/)
    const standings = page.getByTestId('competition-standings')
    const webPoints: string[] = []
    for (const entry of entries) {
        const points = standings.getByTestId(`standing-points-${entry.bib}`)
        await expect(points).toHaveText(/\d/)
        webPoints.push((await points.textContent())!.trim())
    }
    expect(webPoints).toEqual(['833.33', '833.33', '333.33'])

    await gotoSettled(page, `/competitions/${competition.id}/tv`, /\/tv/)
    const tv = page.getByTestId('competition-tv')
    for (const [index, entry] of entries.entries())
        await expect(
            tv.getByTestId(`tv-standing-points-${entry.bib}`),
        ).toHaveText(webPoints[index]!)
})
