import type { Page } from '@playwright/test'
import { createRating, deleteRating } from './api'
import { apiOf } from './nav'

export async function createComment(
    page: Page,
    routeId: string,
    comment: string,
    rating = 5,
): Promise<string> {
    return (await createRating(await apiOf(page), routeId, { rating, comment }))
        .id
}

export async function deleteComment(page: Page, id: string) {
    await deleteRating(await apiOf(page), id)
}
