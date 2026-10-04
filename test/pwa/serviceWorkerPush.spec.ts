import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')

type Handler = (event: any) => void

function loadWorker(windows: any[] = []) {
    const handlers: Record<string, Handler> = {}
    const self = {
        location: new URL('https://gripello.app/sw.js?build=1'),
        addEventListener: (type: string, handler: Handler) => {
            handlers[type] = handler
        },
        registration: {
            showNotification: vi.fn().mockResolvedValue(undefined),
        },
        clients: {
            matchAll: vi.fn().mockResolvedValue(windows),
            openWindow: vi.fn().mockResolvedValue(undefined),
        },
    }
    runInNewContext(source, { self, URL, caches: {} })
    return { handlers, self }
}

async function dispatch(handler: Handler | undefined, event: object) {
    let done: Promise<unknown> = Promise.resolve()
    handler!({
        ...event,
        waitUntil: (promise: Promise<unknown>) => (done = promise),
    })
    await done
}

describe('service worker push', () => {
    let worker: ReturnType<typeof loadWorker>

    beforeEach(() => {
        worker = loadWorker()
    })

    it('shows the title, body and link the server sent', async () => {
        await dispatch(worker.handlers.push, {
            data: {
                json: () => ({
                    title: 'Gripello',
                    body: 'New routes on Cave: 3',
                    url: '/e2e/routes',
                    tag: 'wall_new_routes',
                }),
            },
        })
        expect(worker.self.registration.showNotification).toHaveBeenCalledWith(
            'Gripello',
            {
                body: 'New routes on Cave: 3',
                tag: 'wall_new_routes',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                data: { url: '/e2e/routes' },
            },
        )
    })

    it('still shows a notification for an empty or broken payload', async () => {
        await dispatch(worker.handlers.push, { data: null })
        await dispatch(worker.handlers.push, {
            data: {
                json: () => {
                    throw new SyntaxError('bad json')
                },
            },
        })
        const calls = worker.self.registration.showNotification.mock.calls
        expect(calls).toHaveLength(2)
        for (const [title, options] of calls) {
            expect(title).toBe('Gripello')
            expect(options.data).toEqual({ url: '/' })
        }
    })
})

describe('service worker notification click', () => {
    function click(url?: string) {
        return {
            notification: { close: vi.fn(), data: url ? { url } : undefined },
        }
    }

    it('opens the link in an already open window', async () => {
        const open = {
            focus: vi.fn(),
            navigate: vi.fn().mockResolvedValue(undefined),
        }
        open.focus.mockResolvedValue(open)
        const { handlers, self } = loadWorker([open])
        const event = click('/e2e/routes')

        await dispatch(handlers.notificationclick, event)

        expect(event.notification.close).toHaveBeenCalled()
        expect(open.navigate).toHaveBeenCalledWith(
            'https://gripello.app/e2e/routes',
        )
        expect(self.clients.openWindow).not.toHaveBeenCalled()
    })

    it('opens a new window when none is open', async () => {
        const { handlers, self } = loadWorker()
        await dispatch(handlers.notificationclick, click())
        expect(self.clients.openWindow).toHaveBeenCalledWith(
            'https://gripello.app/',
        )
    })

    it('falls back to a new window when the open one cannot navigate', async () => {
        const open = {
            focus: vi.fn().mockRejectedValue(new Error('not focusable')),
        }
        const { handlers, self } = loadWorker([open])
        await dispatch(handlers.notificationclick, click('/logbook'))
        expect(self.clients.openWindow).toHaveBeenCalledWith(
            'https://gripello.app/logbook',
        )
    })
})
