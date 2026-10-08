import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'

test('a climber signs up and the desk checks them in', async ({
    userPage,
    setterPage,
    root,
    workerLocation,
    testPrefix,
}) => {
    const competition = await root.collection('competitions').create({
        name: `${testPrefix} Night Session`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: '2030-10-10 17:00:00.000Z',
        ends_at: '2030-10-10 21:00:00.000Z',
        registration_url: 'https://example.com/shop',
        requires_payment: true,
        live_ranking: true,
    })
    await root
        .collection('competition_categories')
        .create({ competition: competition.id, name: 'Open' })
    const displayName = `${testPrefix} Climber`

    await gotoSettled(userPage, '/competitions', /\/competitions/)
    await userPage.getByTestId(`competition-card-${competition.id}`).click()
    await expect(userPage.getByTestId('competition-public-phase')).toHaveText(
        'Registration open',
    )
    await userPage.getByTestId('competition-rules-link').click()
    await expect(
        userPage.getByTestId('competition-rule-boulder.dynamicTop'),
    ).toBeVisible()
    await userPage.getByTestId('page-back').click()
    await userPage.getByTestId('competition-register-name').fill(displayName)
    await userPage.getByTestId('competition-register-birth-year').fill('1990')
    await userPage.getByTestId('competition-register-birth-year').blur()
    await userPage.getByTestId('competition-register-submit').click()

    await expect(userPage.getByTestId('competition-my-bib')).toHaveText('1')
    await expect(userPage.getByTestId('competition-my-paid')).toHaveText(
        'Not paid',
    )
    await expect(userPage.getByTestId('competition-pay-link')).toBeVisible()

    await gotoSettled(
        setterPage,
        `/manage/competitions/${competition.id}`,
        /\/manage\/competition/,
    )
    const row = setterPage.getByTestId('competition-entry-1')
    await expect(row).toContainText(displayName)
    await row.getByTestId('competition-entry-checkin-1').click()
    await expect(row.getByTestId('competition-entry-status-1')).toHaveText(
        'Checked in',
    )
    await row.getByTestId('competition-entry-paid-1').click()
    await expect
        .poll(async () => {
            const entry = await root
                .collection('competition_entries')
                .getFirstListItem(
                    root.filter('competition = {:id}', { id: competition.id }),
                )
            return [entry.status, entry.paid]
        })
        .toEqual(['checked_in', true])

    await gotoSettled(
        userPage,
        `/competitions/${competition.id}`,
        /\/competition/,
    )
    await expect(userPage.getByTestId('competition-my-paid')).toHaveText('Paid')
    await userPage.getByTestId('competition-withdraw').click()
    await userPage.getByTestId('confirm-dialog-confirm').click()
    await expect(userPage.getByTestId('competition-rejoin')).toBeVisible()
})
