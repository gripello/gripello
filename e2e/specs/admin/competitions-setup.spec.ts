import { test, expect } from '../../support/fixtures'
import type { Api } from '../../support/api'
import { gotoSettled } from '../../support/nav'
import {
    createCompetition,
    createCompetitionCategory,
    listCompetitionCategories,
} from '../../support/api'
import type {
    CompetitionRecord,
    CompetitionRouteRecord,
} from '../../../types/models'

const competitionRoutes = async (
    api: Api,
    competition: string,
): Promise<CompetitionRouteRecord[]> =>
    (
        await api.get<{ items: CompetitionRouteRecord[] }>(
            `/competitions/${competition}/routes`,
        )
    ).items

test('a setter creates a competition with default categories', async ({
    setterPage,
    adminApi,
    testPrefix,
}) => {
    const name = `${testPrefix} Autumn Jam`
    await gotoSettled(
        setterPage,
        '/manage/competitions',
        /\/manage\/competitions/,
    )
    await setterPage.getByTestId('competitions-new').click()

    const dialog = setterPage.getByTestId('competition-form-dialog')
    await dialog.getByTestId('competition-form-name').fill(name)
    await dialog.getByTestId('competition-form-starts').fill('2030-10-10T10:00')
    await dialog.getByTestId('competition-form-ends').fill('2030-10-10T14:00')
    await dialog.getByTestId('competition-form-format-ifsc').click()
    await dialog.getByTestId('competition-form-save').click()

    await expect(setterPage).toHaveURL(/\/manage\/competitions\/\w+$/)
    await expect(setterPage.getByRole('heading', { level: 1 })).toHaveText(name)
    await expect(setterPage.getByTestId('competition-phase')).toHaveText(
        'Draft',
    )
    await expect(
        setterPage.getByTestId('competition-checklist-categories'),
    ).toHaveAttribute('data-done', 'true')
    await expect(
        setterPage.getByTestId('competition-action-open'),
    ).toBeDisabled()

    const { items } = await adminApi.get<{ items: CompetitionRecord[] }>(
        '/gyms/e2e/competitions',
        { status: 'draft' },
    )
    const competition = items.find((item) => item.name === name)!
    expect(competition.scoring_format).toBe('ifsc')
    const categories = await listCompetitionCategories(adminApi, competition.id)
    expect(categories.map((category) => category.gender).sort()).toEqual([
        'female',
        'male',
    ])
})

test('a setter adds boulders, opens the competition and copies it', async ({
    setterPage,
    adminApi,
    workerLocation,
    createRoute,
    testPrefix,
}) => {
    const boulder = await createRoute({
        type: 'Boulder',
        name: `${testPrefix} Pinch`,
    })
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} League 1`,
        location: workerLocation.id,
        status: 'draft',
        starts_at: '2030-10-10T10:00:00Z',
        ends_at: '2030-10-10T14:00:00Z',
        discipline: 'boulder',
        scoring_format: 'dynamic',
        live_ranking: true,
    })
    await createCompetitionCategory(adminApi, competition.id, { name: 'Open' })

    await gotoSettled(
        setterPage,
        `/manage/competitions/${competition.id}`,
        /\/manage\/competition/,
    )
    await setterPage.getByTestId('competition-route-picker').click()
    await setterPage
        .getByRole('option', { name: new RegExp(boulder.name) })
        .click()
    await setterPage.keyboard.press('Escape')
    await setterPage.getByTestId('competition-route-add').click()

    const row = setterPage.getByTestId('competition-route-1')
    await expect(row).toContainText(boulder.name)

    await setterPage.getByTestId('competition-action-open').click()
    await setterPage.getByTestId('confirm-dialog-confirm').click()
    await expect(setterPage.getByTestId('competition-phase')).toHaveText(
        'Registration open',
    )
    await expect(setterPage.getByTestId('competition-share-url')).toHaveValue(
        new RegExp(`/competitions/${competition.id}$`),
    )
    await expect(row.getByTestId('competition-route-delete-1')).toHaveCount(0)

    await row.getByTestId('competition-route-voided-1').click()
    await expect
        .poll(async () => {
            const [saved] = await competitionRoutes(adminApi, competition.id)
            return saved?.voided
        })
        .toBe(true)

    await setterPage.getByTestId('competition-more').click()
    await setterPage.getByTestId('competition-copy').click()
    await expect(setterPage.getByRole('heading', { level: 1 })).toContainText(
        `${testPrefix} League 1`,
    )
    await expect(setterPage).not.toHaveURL(new RegExp(competition.id))
    await expect(setterPage.getByTestId('competition-phase')).toHaveText(
        'Draft',
    )
})

test('a setter sets up a rope competition with hold counts', async ({
    setterPage,
    adminApi,
    workerLocation,
    createRoute,
    testPrefix,
}) => {
    const rope = await createRoute({ name: `${testPrefix} Arete` })
    await createRoute({ type: 'Boulder', name: `${testPrefix} Crimp` })
    const competition = await createCompetition(adminApi, {
        name: `${testPrefix} Hallencup`,
        location: workerLocation.id,
        status: 'draft',
        starts_at: '2030-11-10T10:00:00Z',
        ends_at: '2030-11-10T14:00:00Z',
        discipline: 'rope',
        scoring_format: 'lead_height',
        live_ranking: true,
    })

    await gotoSettled(
        setterPage,
        `/manage/competitions/${competition.id}`,
        /\/manage\/competition/,
    )
    await setterPage.getByTestId('competition-route-picker').click()
    await expect(
        setterPage.getByRole('option', {
            name: new RegExp(`${testPrefix} Crimp`),
        }),
    ).toHaveCount(0)
    await setterPage
        .getByRole('option', { name: new RegExp(rope.name) })
        .click()
    await setterPage.keyboard.press('Escape')
    await setterPage.getByTestId('competition-route-add').click()

    const row = setterPage.getByTestId('competition-route-1')
    await expect(row).toContainText(rope.name)
    await expect(row.getByTestId('competition-route-zone-1')).toHaveCount(0)
    await row.getByTestId('competition-route-holds-1').fill('42')
    await row.getByTestId('competition-route-holds-1').blur()
    await expect
        .poll(async () => {
            const [saved] = await competitionRoutes(adminApi, competition.id)
            return saved?.hold_count
        })
        .toBe(42)
})
