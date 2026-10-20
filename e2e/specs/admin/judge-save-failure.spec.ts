import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import { listCompetitionScores, putCompetitionScores } from '../../support/api'
import { BOULDER, openBoulderCompetition } from '../../support/competitions'

test('a failed judge save keeps the score, says so and a retry saves it once', async ({
    adminPage,
    adminApi,
    workerLocation,
    createRoute,
    createUser,
    testPrefix,
}) => {
    const climber = await createUser('user', 'unsaved')
    const {
        competition,
        entries: [entry],
    } = await openBoulderCompetition(adminApi, {
        name: `${testPrefix} Retry Cup`,
        location: workerLocation.id,
        routes: [await createRoute({ name: `${testPrefix} B1`, ...BOULDER })],
        climbers: [{ user: climber, name: `${testPrefix} Climber` }],
    })
    const bib = entry!.bib
    const scoresUrl = (url: URL) =>
        url.pathname === `/api/competitions/${competition.id}/scores`
    let failed = 0
    await adminPage.route(scoresUrl, async (route) => {
        if (route.request().method() !== 'PUT' || failed > 0)
            return route.fallback()
        failed += 1
        await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ status: 500, message: 'boom', data: {} }),
        })
    })

    await gotoSettled(
        adminPage,
        gymPath(`/manage/competitions/${competition.id}/judge`),
    )
    const row = adminPage.getByTestId(`judge-entry-${bib}`)
    await row.getByTestId(`judge-top-${bib}`).click()

    await expect(row.getByTestId(`judge-unsaved-${bib}`)).toBeVisible()
    await expect(row.getByTestId(`judge-top-${bib}`)).toHaveText(/Flash/)
    expect(await listCompetitionScores(adminApi, competition.id)).toEqual([])

    await row.getByTestId(`judge-retry-${bib}`).click()
    await expect(row.getByTestId(`judge-unsaved-${bib}`)).toBeHidden()
    await expect
        .poll(async () =>
            (await listCompetitionScores(adminApi, competition.id)).map(
                (score) => [score.entry, score.top_attempt],
            ),
        )
        .toEqual([[entry!.id, 1]])
    await expect(row.getByTestId(`judge-top-${bib}`)).toHaveText(/Flash/)
})

test('a rejected judge save is discarded and a newer score of another judge wins over an unsaved one', async ({
    adminPage,
    adminApi,
    workerLocation,
    createRoute,
    createUser,
    testPrefix,
}) => {
    const climber = await createUser('user', 'superseded')
    const {
        competition,
        compRoutes: [compRoute],
        entries: [entry],
    } = await openBoulderCompetition(adminApi, {
        name: `${testPrefix} Superseded Cup`,
        location: workerLocation.id,
        routes: [await createRoute({ name: `${testPrefix} B1`, ...BOULDER })],
        climbers: [{ user: climber, name: `${testPrefix} Climber` }],
    })
    const bib = entry!.bib
    let status = 400
    await adminPage.route(
        (url) => url.pathname === `/api/competitions/${competition.id}/scores`,
        async (route) => {
            if (route.request().method() !== 'PUT') return route.fallback()
            await route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify({ status, message: 'no', data: {} }),
            })
        },
    )

    await gotoSettled(
        adminPage,
        gymPath(`/manage/competitions/${competition.id}/judge`),
    )
    const row = adminPage.getByTestId(`judge-entry-${bib}`)
    const top = row.getByTestId(`judge-top-${bib}`)
    await top.click()
    await expect(row.getByTestId(`judge-unsaved-${bib}`)).toBeHidden()
    await expect(top).not.toHaveText(/Flash/)

    status = 503
    await top.click()
    await expect(row.getByTestId(`judge-unsaved-${bib}`)).toBeVisible()

    await putCompetitionScores(adminApi, competition.id, [
        {
            entry: entry!.id,
            comp_route: compRoute!.id,
            attempts: 3,
            zone_attempt: 2,
        },
    ])
    await expect(row.getByTestId(`judge-unsaved-${bib}`)).toBeHidden()
    await expect(row.getByTestId(`judge-retry-${bib}`)).toBeHidden()
    await expect(top).not.toHaveText(/Flash/)
})
