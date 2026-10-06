import { expect, type Page } from '@playwright/test'
import type PocketBase from 'pocketbase'
import { gotoSettled } from './nav'
import { ensureUser, uiaa, type SeededUser } from './seed'

export async function openCase(
    page: Page,
    text: string,
    path = '/manage/moderation',
    view?: 'decide' | 'approval' | 'hidden' | 'history' | 'all',
) {
    await gotoSettled(page, `${path}?search=${encodeURIComponent(text)}`)
    if (view) await page.getByTestId(`moderation-view-${view}`).click()
    await page
        .getByTestId('moderation-list')
        .getByRole('button', { name: new RegExp(text) })
        .click()
    const detail = page.locator(
        'article[data-testid^="moderation-detail-"]:visible',
    )
    await expect(detail).toContainText(text)
    return detail
}

export async function decide(
    page: Page,
    action: 'approve' | 'hide' | 'restore' | 'reject',
    reason = '',
) {
    await page.locator(`[data-testid="moderation-${action}"]:visible`).click()
    if (action === 'hide' || action === 'reject') {
        await page.getByTestId('moderation-reason').fill(reason)
        await page.getByTestId('moderation-decision-confirm').click()
        await expect(
            page.getByTestId('moderation-decision-dialog'),
        ).toBeHidden()
    }
}

export interface ModerationGym {
    id: string
    slug: string
    routeId: string
    staff: SeededUser
}

// Gym-wide switches (upload approval) get their own gym so parallel specs on the shared one stay unaffected.
export async function createModerationGym(
    root: PocketBase,
    prefix: string,
): Promise<ModerationGym> {
    const slug = `${prefix}-gym`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const gym = await root.collection('gyms').create({
        slug,
        name: `${prefix} Gym`,
        active: true,
        features: { beta_videos: true },
    })
    const location = await root
        .collection('locations')
        .create({ name: `${prefix} Hall`, gym: gym.id })
    const route = await root.collection('routes').create({
        name: `${prefix} Route`,
        ...uiaa('5'),
        anchor_point: 1,
        type: 'Route',
        color: '#F44336',
        creator: ['E2E'],
        screw_date: new Date().toISOString().slice(0, 10),
        location: location.id,
    })
    const staff = await ensureUser(root, undefined, 'user', `${prefix}-staff`)
    const admin = await root
        .collection('roles')
        .getFirstListItem(
            root.filter('gym = {:gym} && name = "admin"', { gym: gym.id }),
        )
    await root
        .collection('memberships')
        .create({ user: staff.id, gym: gym.id, role: admin.id })
    return { id: gym.id, slug, routeId: route.id, staff }
}

export async function inboxCount(page: Page): Promise<number> {
    const sidebar = page
        .getByTestId('nav-link-manage-moderation')
        .locator('xpath=ancestor::a')
    const phone = page.getByTestId('bottom-nav-manage-moderation-count')
    const badge = sidebar.or(phone).filter({ visible: true }).first()
    const digits = (await badge.innerText()).match(/\d+/)
    return digits ? Number(digits[0]) : 0
}

// A member of `gymId` holding exactly `permissions`, for permission-scoped checks.
export async function staffOf(
    root: PocketBase,
    gymId: string,
    permissions: string[],
    label: string,
): Promise<SeededUser> {
    const granted = await root.collection('permissions').getFullList({
        filter: permissions
            .map((name) => root.filter('name = {:name}', { name }))
            .join(' || '),
    })
    const role = await root.collection('roles').create({
        gym: gymId,
        name: label,
        permissions: granted.map((permission) => permission.id),
    })
    const user = await ensureUser(root, undefined, 'user', label)
    await root
        .collection('memberships')
        .create({ user: user.id, gym: gymId, role: role.id })
    return user
}
