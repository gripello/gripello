import { expect, type Page } from '@playwright/test'
import { gotoSettled } from './nav'
import {
    apiAs,
    createGym,
    createLocation,
    createRole,
    createRoute,
    platformAdminApi,
    routeInput,
    setGymFeatures,
} from './api'
import { ensureUser, gripelloAdmin, type SeededUser } from './seed'

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
    prefix: string,
): Promise<ModerationGym> {
    const slug = `${prefix}-gym`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const platform = await platformAdminApi()
    const gym = await createGym(platform, {
        slug,
        name: `${prefix} Gym`,
        active: true,
    })
    await setGymFeatures(platform, gym.id, { beta_videos: true })
    const staff = await ensureUser(null, undefined, 'user', `${prefix}-staff`)
    gripelloAdmin(
        'add-membership',
        '--user',
        staff.id,
        '--gym',
        gym.id,
        '--role',
        'admin',
    )
    const api = await apiAs(staff)
    const location = await createLocation(api, `${prefix} Hall`, gym.id)
    const route = await createRoute(
        api,
        routeInput(`${prefix} Route`, location.id),
        gym.id,
    )
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
    gymId: string,
    permissions: string[],
    label: string,
): Promise<SeededUser> {
    await createRole(await platformAdminApi(), label, permissions, gymId)
    const user = await ensureUser(null, undefined, 'user', label)
    gripelloAdmin(
        'add-membership',
        '--user',
        user.id,
        '--gym',
        gymId,
        '--role',
        label,
    )
    return user
}
