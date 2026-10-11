import { chromium, type Page } from '@playwright/test'

// Prints the requests each journey step makes, to keep journeys.go in sync with the app:
// BASE=http://localhost:3000 GYM=loadtest-1 EMAIL=loadtest+1@example.com PASSWORD=loadtest-password CAP_TOKEN=... node loadtest/record.ts [journey]
const base = process.env.BASE ?? 'http://localhost:3000'
const gym = process.env.GYM ?? 'loadtest-1'
const only = process.argv[2]

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(base + '/api' + path, init)
    if (!response.ok) throw new Error(`${path}: ${response.status}`)
    return response.json() as Promise<T>
}

const gymRecord = await api<{ id: string }>(`/gyms/${gym}`)
const routes = await api<{ items: { id: string }[] }>(
    `/gyms/${gymRecord.id}/routes?limit=5`,
)
const competitions = await api<{ items: { id: string }[] }>(
    `/gyms/${gymRecord.id}/competitions`,
)
const route = routes.items[0]!.id
const competition = competitions.items[0]?.id ?? ''

async function signIn(page: Page, email: string) {
    const login = await api<{ token: string; record: { id: string } }>(
        '/auth/login',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cap-Token': process.env.CAP_TOKEN ?? '',
            },
            body: JSON.stringify({
                identity: email,
                password: process.env.PASSWORD,
            }),
        },
    )
    await page.context().addCookies([
        {
            name: 'pb_auth',
            value: encodeURIComponent(JSON.stringify(login)),
            url: base,
        },
    ])
    return login.record.id
}

async function navigate(page: Page, path: string) {
    await page.waitForFunction(
        () => (document.querySelector('#__nuxt') as any)?.__vue_app__,
    )
    return page.evaluate((to) => {
        const app = (document.querySelector('#__nuxt') as any).__vue_app__
        return app.config.globalProperties.$router.push(to)
    }, path)
}

const tid = (page: Page, id: string) => page.getByTestId(id).first()

async function tick(page: Page) {
    await tid(page, 'tick-open').click()
    await tid(page, 'tick-submit').click()
}

async function review(page: Page) {
    await tid(page, 'review-open-cta').click()
    await page
        .getByTestId('review-form-rating')
        .getByRole('radio')
        .nth(3)
        .click()
    await tid(page, 'review-form-comment').fill('Loadtest review')
    await tid(page, 'review-form-submit').click()
}

async function reportDefect(page: Page) {
    await tid(page, 'task-defect-open').click()
    await tid(page, 'task-defect-category-loose_hold').click()
    await tid(page, 'task-defect-submit').click()
}

async function createRoute(page: Page) {
    await tid(page, 'routes-create-open').click()
    await tid(page, 'route-form-name').fill('Loadtest recorded route')
    await tid(page, 'route-form-difficulty').click()
    await page.getByRole('option').first().click()
    await tid(page, 'route-form-location').click()
    await page.getByRole('option').first().click()
    await tid(page, 'route-form-submit').click()
}

async function createTask(page: Page) {
    await tid(page, 'tasks-new').click()
    await tid(page, 'task-form-title').fill('Loadtest recorded task')
    await page
        .getByTestId('task-form-dialog')
        .locator('input[type="file"]')
        .setInputFiles({
            name: 'photo.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64',
            ),
        })
    await tid(page, 'task-form-save').click()
}

type Step = string | ((page: Page) => Promise<unknown>)
const journeys: Record<string, (page: Page) => Promise<Step[]>> = {
    guest: async () => [
        `/${gym}`,
        `~/${gym}/routes`,
        `~/${gym}/map`,
        `~/${gym}/route?id=${route}`,
        `~/${gym}/info`,
        `~/${gym}/leaderboard`,
        `~/${gym}/feed`,
        `~/${gym}/competitions/${competition}`,
    ],
    qr: async () => [`/route?id=${route}`, `~/scan`],
    climber: async (page) => {
        const me = await signIn(page, process.env.EMAIL!)
        return [
            `/${gym}/routes`,
            `~/${gym}/route?id=${route}`,
            tick,
            review,
            reportDefect,
            '~/logbook',
            '~/friends',
            `~/climber?id=${me}`,
            `~/${gym}/feed`,
            `~/${gym}/leaderboard`,
            `~/${gym}/competitions/${competition}`,
        ]
    },
    staff: async (page) => {
        await signIn(
            page,
            process.env.STAFF_EMAIL ?? `loadtest+staff-1-1@example.com`,
        )
        return [
            `/${gym}/manage`,
            `~/${gym}/manage/routes`,
            createRoute,
            `~/${gym}/manage/tasks`,
            createTask,
            `~/${gym}/manage/competitions/${competition}/judge`,
        ]
    },
    tv: async () => [
        `/${gym}/competitions/${competition}/tv`,
        `/${gym}/leaderboard/tv`,
    ],
}

const browser = await chromium.launch()
for (const [name, steps] of Object.entries(journeys)) {
    if (only && only !== name) continue
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    let lines: string[] = []
    page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.origin !== new URL(base).origin) return
        const body = request.postData()?.slice(0, 300) ?? ''
        lines.push(
            `  ${request.method()} ${url.pathname}${url.search} ${body}`.trimEnd(),
        )
    })
    for (const step of await steps(page)) {
        lines = []
        if (typeof step === 'string' && step.startsWith('~'))
            await navigate(page, step.slice(1))
        else if (typeof step === 'string')
            await page.goto(base + step, { waitUntil: 'networkidle' })
        else
            await step(page).catch((error) => console.log(`  failed: ${error}`))
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1500)
        console.log(`${name} ${typeof step === 'string' ? step : step.name}`)
        console.log(
            lines
                .filter((line) => !/\/_nuxt\/(?!builds)|\/__nuxt/.test(line))
                .join('\n'),
        )
    }
    await context.close()
}
await browser.close()
