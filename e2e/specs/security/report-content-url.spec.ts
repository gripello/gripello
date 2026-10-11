import { test, expect } from '../../support/fixtures'
import { findReport, guestApi } from '../../support/api'

for (const contentUrl of [
    'javascript:alert(document.domain)',
    'https://phishing.example/login',
]) {
    test(`a report cannot choose its own content link: ${contentUrl}`, async ({
        api,
        route,
        testPrefix,
    }) => {
        const { id } = await guestApi().post<{ id: string }>('/reports', {
            content_type: 'route',
            content_id: route.id,
            content_url: contentUrl,
            reason: 'other',
            explanation: `${testPrefix} content url check`,
            notifier_name: 'E2E Reporter',
            notifier_email: 'e2e-reporter@example.com',
            good_faith: true,
        })

        const stored = await findReport(api, id)
        expect(stored?.content_url).toBe(`/route?id=${route.id}`)
    })
}
