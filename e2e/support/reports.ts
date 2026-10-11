import type { Page } from '@playwright/test'
import { fileReport, guestApi } from './api'
import { apiOf } from './nav'

type ReportOptions = {
    contentId: string
    explanation: string
    reason?: string
    notifierName?: string
    notifierEmail?: string
}

export async function createReport(options: ReportOptions): Promise<string> {
    return (await fileReport(guestApi(), { contentType: 'rating', ...options }))
        .id
}

export async function reportAs(
    page: Page,
    options: ReportOptions & {
        contentType: 'rating' | 'route' | 'beta_video' | 'profile'
    },
): Promise<string> {
    return (await fileReport(await apiOf(page), options)).id
}
