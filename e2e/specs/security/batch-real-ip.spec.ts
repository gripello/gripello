import { test, expect } from '../../support/fixtures'

test('a batch sub-request cannot pick its own IP through X-Real-IP', async ({
    request,
    root,
    route,
    testPrefix,
}) => {
    const spoofedIp = '127.0.0.1'

    const batch = await request.post('/api/batch', {
        data: {
            requests: [
                {
                    method: 'POST',
                    url: '/api/collections/reports/records',
                    headers: { 'X-Real-IP': spoofedIp },
                    body: {
                        content_type: 'route',
                        content_id: route.id,
                        reason: 'other',
                        explanation: `${testPrefix} batch real ip`,
                        notifier_name: 'E2E Reporter',
                        notifier_email: 'e2e-reporter@example.com',
                        good_faith: true,
                    },
                },
            ],
        },
    })
    expect(batch.status()).toBe(200)
    const [created] = await batch.json()
    const reportId = created.body.id as string

    const recordedIp = () =>
        root
            .collection('audit_logs')
            .getFirstListItem(
                root.filter(
                    'action = "create" && collection_name = "reports" && record_id = {:reportId}',
                    { reportId },
                ),
                { requestKey: null },
            )
            .then((row) => row.ip as string)
            .catch(() => null)

    await expect.poll(recordedIp).not.toBeNull()
    expect(await recordedIp()).not.toBe(spoofedIp)

    await root.collection('reports').delete(reportId)
})

test('a guest cannot batch several ratings or reports at once', async ({
    request,
}) => {
    const report = (contentId: string) => ({
        method: 'POST',
        url: '/api/collections/reports/records',
        body: {
            content_type: 'route',
            content_id: contentId,
            reason: 'other',
            explanation: 'batched guest report',
            notifier_name: 'E2E Reporter',
            notifier_email: 'e2e-reporter@example.com',
            good_faith: true,
        },
    })

    const batch = await request.post('/api/batch', {
        data: {
            requests: [report('batchguest00001'), report('batchguest00002')],
        },
    })
    expect(batch.status()).toBe(400)
    expect((await batch.json()).message).toMatch(/one at a time/i)
})
