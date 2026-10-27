import { test, expect } from '../../support/fixtures'
import { gotoSubscribed } from '../../support/nav'
import { uiaa } from '../../support/seed'
import {
    createRating,
    e2eGymId,
    updateRating,
    type Api,
} from '../../support/api'

const RATINGS_PATH = /^\/api\/gyms\/[^/]+\/ratings$/

test('an edit landing after a new review does not duplicate the card', async ({
    adminPage: page,
    api,
    adminApi,
    testPrefix,
    createRoute,
}) => {
    const route = await createRoute({ name: `${testPrefix}-dedupe` })
    const review = (author: Api, comment: string) =>
        createRating(author, route.id, {
            rating: 4,
            ...uiaa('5'),
            comment: `${testPrefix} ${comment}`,
        })
    try {
        const edited = await review(adminApi, 'edited')
        await gotoSubscribed(
            page,
            '/manage/comments',
            `gym_changes:${await e2eGymId()}`,
        )
        const searched = page.waitForResponse((response) => {
            const url = new URL(response.url())
            return (
                RATINGS_PATH.test(url.pathname) &&
                url.searchParams.get('q') === testPrefix
            )
        })
        await page.getByTestId('filter-search').fill(testPrefix)
        await searched
        const editedCard = page.getByTestId(`comment-card-${edited.id}`)
        await expect(editedCard).toBeVisible()

        let releaseEditFetch = () => {}
        const editFetchReleased = new Promise<void>(
            (resolve) => (releaseEditFetch = resolve),
        )
        await page.route(
            (url) =>
                RATINGS_PATH.test(url.pathname) &&
                url.searchParams.get('ids') === edited.id,
            async (held) => {
                await editFetchReleased
                await held.continue()
            },
        )
        await updateRating(adminApi, edited.id, {
            comment: `${testPrefix} edited later`,
        })

        const added = await review(api, 'added')
        const addedCard = page.getByTestId(`comment-card-${added.id}`)
        await expect(addedCard).toBeVisible()

        releaseEditFetch()
        await expect(editedCard).toContainText('edited later')
        await expect(editedCard).toHaveCount(1)
        await expect(addedCard).toBeVisible()
    } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
    }
})
