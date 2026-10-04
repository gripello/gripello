import { test, expect } from '../../support/fixtures'
import { waitForMail } from '../../support/mail'

test('an urgent defect report emails the task managers', async ({
    request,
    route,
    createUser,
    testPrefix,
}) => {
    const setter = await createUser('routesetter', 'alert')

    const created = await request.post('/api/collections/tasks/records', {
        data: {
            kind: 'defect',
            route: route.id,
            category: 'loose_bolt',
            description: `${testPrefix} <b>third bolt</b> spins`,
        },
    })
    expect(created.ok()).toBe(true)

    const alert = await waitForMail(request, setter.email, {
        subject: /Urgent: Loose bolt/,
        bodyIncludes: route.name,
    })
    expect(alert.HTML).toContain(`/route?id=${route.id}`)
    expect(alert.HTML).not.toContain('<b>third bolt</b>')
})

test('task managers get the alert in their own language', async ({
    request,
    root,
    route,
    createUser,
    testPrefix,
}) => {
    const setter = await createUser('routesetter', 'alert-de')
    await root.collection('users').update(setter.id, { language: 'de' })

    const created = await request.post('/api/collections/tasks/records', {
        data: {
            kind: 'defect',
            route: route.id,
            category: 'loose_bolt',
            description: `${testPrefix} anchor spins`,
        },
    })
    expect(created.ok()).toBe(true)

    const alert = await waitForMail(request, setter.email, {
        subject: /Dringend: Lockere Schraube/,
        bodyIncludes: route.name,
    })
    expect(alert.HTML).toContain('lang="de"')
    expect(alert.Text).toContain(`/route?id=${route.id}`)
})
