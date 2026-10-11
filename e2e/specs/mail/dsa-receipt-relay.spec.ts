import { test, expect } from '../../support/fixtures'
import { mailbox, waitForMail } from '../../support/mail'

test('an anonymous notice cannot relay its own text to any mailbox', async ({
    request,
    route,
    testPrefix,
}) => {
    const recipient = mailbox(testPrefix, 'victim')
    const spamName = `${testPrefix}-WIN-A-PRIZE`
    const spamText = `${testPrefix}-cheap-pills-at-spam.example`

    const created = await request.post('/api/reports', {
        data: {
            content_type: 'route',
            content_id: route.id,
            content_url: 'https://spam.example/offer',
            reason: 'spam_fraud',
            explanation: spamText,
            notifier_name: spamName,
            notifier_email: recipient,
            good_faith: true,
        },
    })
    expect(created.ok()).toBe(true)
    const { id } = await created.json()

    const receipt = await waitForMail(request, recipient, {
        subject: /received/i,
    })
    expect(receipt.HTML).toContain(id)
    for (const injected of [spamName, spamText, 'spam.example']) {
        expect(receipt.HTML).not.toContain(injected)
    }
})
