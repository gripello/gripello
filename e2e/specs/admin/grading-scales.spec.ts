import { test, expect } from '../../support/fixtures'
import { gotoSettled } from '../../support/nav'
import { e2eGymId, gradeOf } from '../../support/seed'

test('settings show the grading scale per route type', async ({
    adminPage: page,
}) => {
    await gotoSettled(page, '/admin/settings?section=grading')

    const routeScale = page.getByTestId('settings-route-grade-system')
    const boulderScale = page.getByTestId('settings-boulder-grade-system')
    await expect(routeScale).toContainText('UIAA')
    await expect(boulderScale).toContainText('Fontainebleau')

    await routeScale.click()
    for (const name of ['UIAA', 'French', 'YDS']) {
        await expect(
            page.getByRole('option', { name, exact: true }),
        ).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(
        page.getByRole('option', { name: 'UIAA', exact: true }),
    ).toBeHidden()

    await boulderScale.click()
    for (const name of ['Fontainebleau', 'V-Scale']) {
        await expect(
            page.getByRole('option', { name, exact: true }),
        ).toBeVisible()
    }
})

test('creates a boulder graded on the boulder scale', async ({
    adminPage: page,
    root,
    testPrefix,
    workerLocation,
}) => {
    await gotoSettled(page, '/manage/routes')
    const name = `${testPrefix}-bldr`

    await page.getByTestId('routes-create-open').click()
    await page.getByTestId('route-form-name').fill(name)
    await page.getByTestId('route-form-type').click()
    await page.getByRole('option', { name: 'Boulder', exact: true }).click()
    await expect(
        page.getByTestId('route-form-difficulty'),
    ).toHaveAccessibleName(/Fontainebleau/)
    await page.getByTestId('route-form-difficulty').click()
    await page.getByRole('option', { name: '6A+', exact: true }).click()
    await expect(page.getByTestId('route-form-anchor-point')).toHaveCount(0)
    await page.getByTestId('route-form-location').click()
    await page
        .getByRole('option', { name: workerLocation.name, exact: true })
        .click()
    await expect(page.getByRole('listbox')).toBeHidden()
    await page.getByTestId('route-form-creator').fill('E2E')
    await page.keyboard.press('Enter')
    await page.getByTestId('route-form-screw-date').fill('2026-01-01')
    await page.getByTestId('route-form-submit').click()
    await expect(page.getByTestId('route-form-dialog')).toBeHidden()

    const created = await root
        .collection('routes')
        .getFirstListItem(root.filter('name = {:name}', { name }))
    expect(created).toMatchObject({
        grade: '6A+',
        grade_system: 'font',
        grade_index: 16.4,
        anchor_point: 0,
    })
    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).toContainText('6A+')
    await expect(
        page.getByTestId('routes-table').locator('tbody'),
    ).not.toContainText('Font')
})

test('editing keeps the route scale and switching type resets the grade', async ({
    adminPage: page,
    root,
    testPrefix,
}) => {
    const name = `${testPrefix}-french-route`
    await root.collection('routes').create({
        gym: await e2eGymId(root),
        name,
        ...gradeOf('french', '6b'),
        type: 'Route',
        anchor_point: 3,
        creator: ['E2E'],
    })
    await gotoSettled(page, '/manage/routes')
    await page.getByTestId('filter-search').fill(name)
    await expect(page.getByTestId('routes-table')).toContainText('6b')
    await expect(page.getByTestId('routes-table')).toContainText('Fr')
    await expect(
        page.getByTestId('routes-table').locator('thead'),
    ).toContainText('Grade (UIAA · Font)')

    await page.getByTestId('routes-row-edit').first().click()
    const grade = page.getByTestId('route-form-difficulty')
    await expect(grade).toHaveAccessibleName(/French/)
    await expect(grade).toContainText('6b')

    await page.getByTestId('route-form-type').click()
    await page.getByRole('option', { name: 'Boulder', exact: true }).click()
    await expect(grade).toHaveAccessibleName(/Fontainebleau/)
    await expect(grade).not.toContainText('6b')

    await page.getByTestId('route-form-type').click()
    await page.getByRole('option', { name: 'Route', exact: true }).click()
    await expect(grade).toHaveAccessibleName(/French/)
})

test('route page links its grade to the IRCRA conversion table', async ({
    page,
    root,
    testPrefix,
}) => {
    const route = await root.collection('routes').create({
        gym: await e2eGymId(root),
        name: `${testPrefix}-conversion`,
        ...gradeOf('french', '7a'),
        type: 'Route',
        anchor_point: 2,
        creator: ['E2E'],
    })
    await gotoSettled(page, `/route?id=${route.id}`)
    await expect(page.getByTestId('route-grade-system')).toHaveText('Fr')
    await page.getByTestId('route-grade-badge').click()

    const dialog = page.getByTestId('grade-conversion-dialog')
    await expect(dialog).toContainText('IRCRA')
    await expect(dialog.getByTestId('grade-conversion-french-7a')).toHaveClass(
        /grade-conversion__label--highlight/,
    )
    for (const testId of [
        'grade-conversion-yds-5.11d',
        'grade-conversion-uiaa-8',
        'grade-conversion-font-6B',
        'grade-conversion-v-V3',
        'grade-conversion-orientation-6',
        'grade-conversion-band-black',
    ]) {
        await expect(dialog.getByTestId(testId)).toBeAttached()
    }
})

test('settings open the conversion table', async ({ adminPage: page }) => {
    await gotoSettled(page, '/admin/settings?section=grading')
    await page.getByTestId('grade-conversion-open').click()
    await expect(page.getByTestId('grade-conversion-dialog')).toBeVisible()
    await expect(page.getByTestId('grade-conversion-french-6a')).toBeVisible()
})
