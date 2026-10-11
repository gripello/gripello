import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { createCompetition, createCompetitionCategory } from '../../support/api'
import type { CompetitionEntryRecord } from '../../../types/models'

test('a climber signs up and the desk checks them in', async ({
    userPage,
    setterPage,
    adminApi,
    workerLocation,
    testPrefix,
}) => {
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} Night Session`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        starts_at: '2030-10-10T17:00:00Z',
        ends_at: '2030-10-10T21:00:00Z',
        registration_url: 'https://example.com/shop',
        requires_payment: true,
        live_ranking: true,
    })
    await createCompetitionCategory(adminApi, competition.id, { name: 'Open' })
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
            const { items } = await adminApi.get<{
                items: CompetitionEntryRecord[]
            }>(`/competitions/${competition.id}/entries`)
            return [items[0]?.status, items[0]?.paid]
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
