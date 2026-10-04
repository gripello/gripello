import PocketBase from 'pocketbase'
import { test, expect } from '../../support/fixtures'
import { gotoSubscribed } from '../../support/nav'
import { PB_URL } from '../../support/map'
import { authAsSuperuser, ensureLocations, uiaa } from '../../support/seed'

test('an edit landing after a new review does not duplicate the card', async ({
    adminPage: page,
    testPrefix,
}) => {
    const root = new PocketBase(PB_URL)
    await authAsSuperuser(root)
    const locations = await ensureLocations(root)
    const route = await root.collection('routes').create({
        name: `${testPrefix}-dedupe`,
        ...uiaa('5'),
        location: locations['Hall A'],
        type: 'Route',
        creator: ['E2E'],
    })
    const review = (comment: string) =>
        root.collection('ratings').create({
            route_id: route.id,
            rating: 4,
            ...uiaa('5'),
            comment: `${testPrefix} ${comment}`,
        })
    try {
        const edited = await review('edited')
        await gotoSubscribed(page, '/manage/comments', 'ratings')
        const searched = page.waitForResponse(
            (response) =>
                response.url().includes('/api/collections/ratings/records') &&
                response.url().includes('sort=-created') &&
                decodeURIComponent(response.url()).includes(
                    `comment ~ "${testPrefix}"`,
                ),
        )
        await page.getByTestId('filter-search').fill(testPrefix)
        await searched
        const editedCard = page.getByTestId(`comment-card-${edited.id}`)
        await expect(editedCard).toBeVisible()

        let markEditFetchHeld = () => {}
        const editFetchHeld = new Promise<void>((resolve) => {
            markEditFetchHeld = resolve
        })
        let releaseEditFetch = () => {}
        const editFetchReleased = new Promise<void>((resolve) => {
            releaseEditFetch = resolve
        })
        await page.route(
            (url) =>
                url.pathname.endsWith(
                    `/collections/ratings/records/${edited.id}`,
                ),
            async (held) => {
                markEditFetchHeld()
                await editFetchReleased
                await held.continue()
            },
        )
        await root
            .collection('ratings')
            .update(edited.id, { comment: `${testPrefix} edited later` })
        await editFetchHeld

        const added = await review('added')
        const addedCard = page.getByTestId(`comment-card-${added.id}`)
        await expect(addedCard).toBeVisible()

        releaseEditFetch()
        await expect(editedCard).toContainText('edited later')
        await expect(editedCard).toHaveCount(1)
        await expect(addedCard).toBeVisible()
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await root.collection('routes').delete(route.id)
    }
})
