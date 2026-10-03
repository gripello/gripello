import { test, expect } from '../../support/fixtures'
import { gotoSettled, gymPath } from '../../support/nav'
import type { Page } from '@playwright/test'

const RELEASE_PAYLOAD = {
    installed: {
        raw: '1.9.0',
        base: '1.9.0',
        ahead: 0,
        sha: null,
        notes: '## Installed\n* the running build',
    },
    latest: {
        tag: 'v1.10.0',
        notes: '## What changed\n* **Bold** fix\n* https://github.com/o/r/pull/42',
        publishedAt: '2026-01-02T00:00:00Z',
    },
    commits: [],
    mode: 'release',
    updateAvailable: true,
    error: null,
}

const COMMIT_PAYLOAD = {
    installed: {
        raw: '1.9.0-2-gabc1234',
        base: '1.9.0',
        ahead: 2,
        sha: 'abc1234',
        notes: null,
    },
    latest: { tag: 'v1.9.0', notes: 'notes', publishedAt: null },
    commits: [
        {
            sha: 'bbbbbbb',
            message: 'second commit',
            date: '2026-01-02T00:00:00Z',
        },
        {
            sha: 'aaaaaaa',
            message: 'first commit',
            date: '2026-01-01T00:00:00Z',
        },
    ],
    mode: 'commit',
    updateAvailable: true,
    error: null,
}

const UP_TO_DATE = {
    installed: {
        raw: '1.9.0',
        base: '1.9.0',
        ahead: 0,
        sha: null,
        notes: 'notes',
    },
    latest: { tag: 'v1.9.0', notes: 'notes', publishedAt: null },
    commits: [],
    mode: 'none',
    updateAvailable: false,
    error: null,
}

async function stubVersion(page: Page, payload: unknown) {
    await page.route('**/api/version', (route) =>
        route.fulfill({ json: payload }),
    )
}

test('announces a new release next to the version and opens its notes', async ({
    adminPage: page,
}) => {
    await stubVersion(page, RELEASE_PAYLOAD)
    await gotoSettled(page, gymPath('/'))

    await page.getByTestId('footer-update').click()

    const dialog = page.getByTestId('release-notes-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('v1.10.0')
    await expect(dialog).toContainText('Bold fix')
    await expect(dialog).not.toContainText('**')
    await expect(dialog.locator('a[href$="/pull/42"]')).toHaveText('#42')
})

test('announces new commits and lists them', async ({ adminPage: page }) => {
    await stubVersion(page, COMMIT_PAYLOAD)
    await gotoSettled(page, gymPath('/'))

    await page.getByTestId('footer-update').click()

    const dialog = page.getByTestId('commit-list-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('bbbbbbb')
    await expect(dialog).toContainText('second commit')

    const footerVersion = page.getByTestId('footer-version')
    await expect(footerVersion).toHaveText(/\S/)
    await expect(dialog).toContainText((await footerVersion.innerText()).trim())
})

test('stays hidden when the deployment is current', async ({
    adminPage: page,
}) => {
    await stubVersion(page, UP_TO_DATE)
    await gotoSettled(page, gymPath('/'))

    await expect(page.getByTestId('user-menu-activator')).toBeVisible()
    await expect(page.getByTestId('footer-update')).toBeHidden()
})

test('stays hidden for climbers', async ({ userPage: page }) => {
    await stubVersion(page, RELEASE_PAYLOAD)
    await gotoSettled(page, gymPath('/'))

    await expect(page.getByTestId('footer-version')).toBeVisible()
    await expect(page.getByTestId('footer-update')).toBeHidden()
})

test('the footer pill shows the installed release notes to a logged-out visitor', async ({
    page,
}) => {
    await stubVersion(page, UP_TO_DATE)
    await gotoSettled(page, gymPath('/'))

    await expect(page.getByTestId('footer-update')).toBeHidden()

    await page.getByTestId('footer-version').click()

    const dialog = page.getByTestId('release-notes-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('notes')
})
