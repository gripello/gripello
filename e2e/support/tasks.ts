import type { Page } from '@playwright/test'
import { createDefect } from './api'
import { apiOf } from './nav'

export const PNG_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
)

export async function reportDefect(
    page: Page,
    options: { routeId: string; category?: string; description: string },
): Promise<string> {
    const task = await createDefect(
        await apiOf(page),
        options.routeId,
        options.description,
        options.category,
    )
    return task.id
}
