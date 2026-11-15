import { test, expect } from '../../support/fixtures'
import { gotoSettled, pageBack, reloadSettled } from '../../support/nav'
import {
    createCompetition,
    createCompetitionCategory,
    updateCompetition,
} from '../../support/api'
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
    await pageBack(userPage).click()
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
    await expect
        .poll(async () => {
            const { items } = await adminApi.get<{
                items: CompetitionEntryRecord[]
            }>(`/competitions/${competition.id}/entries`)
            return items.map((entry) => entry.status)
        })
        .toEqual(['withdrawn'])
})

// Catches: the rules page showing default rules instead of this competition's settings, or stale ones after a change.
test('the rules page follows the competition settings', async ({
    page,
    adminApi,
    workerLocation,
    testPrefix,
}) => {
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} Lead Cup`,
        location: workerLocation.id,
        status: 'open',
        discipline: 'rope',
        scoring_format: 'lead_height',
        starts_at: '2030-10-10T17:00:00Z',
        ends_at: '2030-10-10T21:00:00Z',
        live_ranking: true,
        freeze_minutes: 15,
    })
    const rule = (key: string) => page.getByTestId(`competition-rule-${key}`)

    await gotoSettled(page, `/competitions/${competition.id}/rules`, /\/rules/)
    await expect(rule('judged')).toBeVisible()
    await expect(rule('selfScore')).toHaveCount(0)
    await expect(rule('ropeStyle')).toHaveCount(0)
    await expect(rule('freeze')).toContainText('15 minutes before the end')

    await updateCompetition(adminApi, competition.id, { live_ranking: false })
    await reloadSettled(page)
    await expect(rule('noLive')).toBeVisible()
    await expect(rule('live')).toHaveCount(0)
    await expect(rule('freeze')).toHaveCount(0)
})
