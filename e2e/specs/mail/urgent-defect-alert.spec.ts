import { test, expect } from '../../support/fixtures'
import { waitForMail } from '../../support/mail'
import { E2E_GYM_SLUG } from '../../support/seed'
import { updateMe } from '../../support/api'

test.setTimeout(120_000)

test('an urgent defect report emails the task managers', async ({
    request,
    route,
    createUser,
    testPrefix,
}) => {
    const setter = await createUser('routesetter', 'alert')

    const created = await request.post(`/api/gyms/${E2E_GYM_SLUG}/tasks`, {
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
        timeoutMs: 90_000,
    })
    expect(alert.HTML).toContain(`/route?id=${route.id}`)
    expect(alert.HTML).not.toContain('<b>third bolt</b>')
})

test('task managers get the alert in their own language', async ({
    request,
    apiAs,
    route,
    createUser,
    testPrefix,
}) => {
    const setter = await createUser('routesetter', 'alert-de')
    await updateMe(await apiAs(setter), { language: 'de' })

    const created = await request.post(`/api/gyms/${E2E_GYM_SLUG}/tasks`, {
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
        timeoutMs: 90_000,
    })
    expect(alert.HTML).toContain('lang="de"')
    expect(alert.Text).toContain(`/route?id=${route.id}`)
})
