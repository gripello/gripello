import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import {
    createCompetition,
    createCompetitionCategory,
    createCompetitionRoute,
    listCompetitionScores,
} from '../../support/api'

test('a climber scores boulders, also without signal', async ({
    userPage,
    adminApi,
    workerLocation,
    createRoute,
    testPrefix,
}) => {
    const hour = 60 * 60 * 1000
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} Live Jam`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: new Date(Date.now() - hour).toISOString(),
        ends_at: new Date(Date.now() + hour).toISOString(),
        live_ranking: true,
    })
    await createCompetitionCategory(adminApi, competition.id, { name: 'Open' })
    const compRouteIds: Record<number, string> = {}
    for (const number of [1, 2, 3]) {
        const boulder = await createRoute({
            type: 'Boulder',
            name: `${testPrefix} Problem ${number}`,
        })
        compRouteIds[number] = (
            await createCompetitionRoute(adminApi, competition.id, {
                route: boulder.id,
                number,
                zone: true,
            })
        ).id
    }
    const savedScore = async (number: number) => {
        const scores = (
            await listCompetitionScores(adminApi, competition.id)
        ).filter((score) => score.comp_route === compRouteIds[number])
        return scores[0]
            ? [
                  scores[0].attempts,
                  scores[0].zone_attempt,
                  scores[0].top_attempt,
              ]
            : null
    }

    await gotoSettled(
        userPage,
        `/competitions/${competition.id}`,
        /\/competition/,
    )
    await userPage
        .getByTestId('competition-register-name')
        .fill(`${testPrefix} Scorer`)
    await userPage.getByTestId('competition-register-birth-year').fill('1990')
    await userPage.getByTestId('competition-register-birth-year').blur()
    await userPage.getByTestId('competition-register-submit').click()

    const card = userPage.getByTestId('competition-scorecard')
    await expect(card).toBeVisible()

    await card.getByTestId('scorecard-attempt-1').click()
    await card.getByTestId('scorecard-zone-1').click()
    await card.getByTestId('scorecard-attempt-1').click()
    await card.getByTestId('scorecard-top-1').click()
    await expect(card.getByTestId('scorecard-top-1')).toHaveText('Top')
    await expect.poll(() => savedScore(1)).toEqual([2, 1, 2])

    await card.getByTestId('scorecard-top-2').click()
    await expect(card.getByTestId('scorecard-top-2')).toHaveText('Flash')
    await expect.poll(() => savedScore(2)).toEqual([1, 1, 1])

    await userPage.context().setOffline(true)
    await card.getByTestId('scorecard-top-3').click()
    await expect(card.getByTestId('scorecard-pending')).toBeVisible()
    expect(await savedScore(3)).toBeNull()
    await userPage.context().setOffline(false)
    await userPage.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect.poll(() => savedScore(3)).toEqual([1, 1, 1])
    await expect(card.getByTestId('scorecard-pending')).toBeHidden()
    await expect(card.getByTestId('scorecard-tops')).toHaveText('3 tops')
})
