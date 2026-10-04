import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'

const ROLLING_PAYLOAD = {
    installed: {
        raw: '2.0.0-2-gabc1234',
        base: '2.0.0',
        ahead: 2,
        sha: 'abc1234',
        notes: [
            "## What's Changed",
            '* feat: new search by @tilalx in https://github.com/gripello/gripello/pull/470',
            '* fix(ui): contrast by @tilalx in https://github.com/gripello/gripello/pull/471',
            '* chore(deps): bump vue by @dependabot[bot] in https://github.com/gripello/gripello/pull/472',
            '',
            '**Full Changelog**: https://github.com/gripello/gripello/compare/v1.10.3...v2.0.0',
        ].join('\n'),
        publishedAt: '2026-09-01T00:00:00Z',
    },
    latest: { tag: 'v2.0.0', notes: null, publishedAt: null },
    commits: [],
    installedCommits: [
        { sha: 'abc1234', message: 'feat(nav): palette (#480)', date: null },
        { sha: 'def5678', message: 'fix: typo', date: null },
    ],
    mode: 'none',
    updateAvailable: false,
    error: null,
}

test('release notes list new commits and filter the release changes', async ({
    page,
}) => {
    await page.route('**/api/version', (route) =>
        route.fulfill({ json: ROLLING_PAYLOAD }),
    )
    await gotoSettled(page, gymPath('/'))
    await page.getByTestId('footer-info').click()
    await page.getByTestId('footer-version').click()

    const dialog = page.getByTestId('release-notes-dialog')
    await expect(dialog.getByTestId('release-notes-commit')).toHaveCount(2)
    await expect(dialog.locator('a[href$="/pull/480"]')).toHaveText('#480')
    await expect(dialog.locator('a[href$="/commit/abc1234"]')).toBeVisible()

    const changes = dialog.getByTestId('release-notes-change')
    await expect(changes).toHaveCount(3)
    await expect(dialog.locator('a[href$="/pull/471"]')).toHaveAttribute(
        'target',
        '_blank',
    )

    await dialog.getByTestId('release-notes-filter-fix').click()
    await expect(changes).toHaveCount(1)
    await expect(changes.first()).toContainText('contrast')

    await expect(dialog.getByTestId('release-notes-compare')).toHaveAttribute(
        'href',
        /\/compare\/v1\.10\.3\.\.\.v2\.0\.0$/,
    )
})
