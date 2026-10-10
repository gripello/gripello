import { test, expect } from '../../support/fixtures'
import { apiOf, gotoSettled } from '../../support/nav'
import { E2E_GYM_SLUG } from '../../support/seed'
import { createComment } from '../../support/comments'
import { createModerationGym } from '../../support/moderation'
import {
    ApiError,
    apiAs,
    createCompetition,
    createRating,
    createRoute,
    deleteGym,
    getRoute,
    routeInput,
    updateRoute,
} from '../../support/api'

const statusOf = (request: Promise<unknown>) =>
    request.then(
        () => 200,
        (error: ApiError) => error.status,
    )

async function foreignGym(prefix: string) {
    const gym = await createModerationGym(prefix)
    const staff = await apiAs(gym.staff)
    const route = await getRoute(staff, gym.routeId)
    return { ...gym, staffApi: staff, route }
}

test('staff of one gym cannot manage another gym', async ({
    setterPage: page,
    api,
    testPrefix,
}) => {
    const other = await foreignGym(testPrefix)
    try {
        await gotoSettled(page, `/${other.slug}/routes`)
        const setter = await apiOf(page)

        expect([400, 403]).toContain(
            await statusOf(
                createRoute(
                    setter,
                    routeInput('Smuggled route', other.route.location!, {
                        anchor_point: 2,
                    }),
                    other.id,
                ),
            ),
        )

        expect([400, 403, 404]).toContain(
            await statusOf(
                updateRoute(setter, other.route.id, { name: 'Hijacked' }),
            ),
        )
        expect((await getRoute(other.staffApi, other.route.id)).name).toBe(
            other.route.name,
        )

        await expect(page.getByTestId('nav-link-routes')).toBeVisible()
        await expect(page.getByTestId('nav-staff-tools')).toHaveCount(0)
        await expect(page.getByTestId('nav-link-manage-routes')).toHaveCount(0)

        await gotoSettled(page, `/${other.slug}/manage/routes`)
        await page.waitForURL((url) => url.pathname === '/')
    } finally {
        await deleteGym(api, other.id)
    }
})

test('pages of one gym do not show records of another gym', async ({
    adminPage: page,
    api,
    testPrefix,
    route,
}) => {
    const other = await foreignGym(testPrefix)
    try {
        const foreignComment = await createRating(
            other.staffApi,
            other.route.id,
            { rating: 4, comment: `${testPrefix}-foreign-comment` },
        )
        const hour = 3_600_000
        const competition = await createCompetition(
            other.staffApi,
            {
                name: `${testPrefix} Foreign Jam`,
                location: other.route.location,
                status: 'open',
                discipline: 'boulder',
                scoring_format: 'dynamic',
                starts_at: new Date(Date.now() - hour).toISOString(),
                ends_at: new Date(Date.now() + hour).toISOString(),
            },
            other.id,
        )

        for (const path of [
            `/${E2E_GYM_SLUG}/competitions/${competition.id}`,
            `/${E2E_GYM_SLUG}/competitions/${competition.id}/rules`,
            `/${E2E_GYM_SLUG}/manage/competitions/${competition.id}`,
        ]) {
            const response = await page.goto(path)
            expect(response?.status(), path).toBe(404)
        }

        await gotoSettled(page, `/${E2E_GYM_SLUG}/manage/comments`)
        const ownComment = await createComment(
            page,
            route.id,
            `${testPrefix}-own-comment`,
        )
        await page.getByTestId('filter-search').fill(testPrefix)
        await expect(
            page.getByTestId(`comment-card-${ownComment}`),
        ).toBeVisible()
        await expect(
            page.getByTestId(`comment-card-${foreignComment.id}`),
        ).toHaveCount(0)
    } finally {
        await deleteGym(api, other.id)
    }
})
