const BUILD = new URL(self.location.href).searchParams.get('build')
const CACHE = `gripello-${BUILD}`
const PAGES = `${CACHE}-pages`
const OFFLINE_URL = '/offline.html'
const PUBLIC_DATA = /^\/(_i18n\/|api\/gyms\/[^/]+\/(walls|locations)$)/
// Members see hidden gyms and their trial, so these live in PAGES, which sign-out clears.
const ROUTE_DATA = /^\/api\/(gyms\/[^/]+(\/routes)?|routes(\/[^/]+)?)$/
const FILES = /^\/api\/files\//
const PUBLIC_PAGE =
    /^\/(?:(?:privacy|imprint|logbook|offline\.html)|(?!(?:account|admin|auth|logbook|manage|platform|scan|competitions)(?:\/|$))[a-z0-9-]{3,40}(?:\/(?:routes|map|route|imprint|privacy))?)?\/?$/
const FILE_CACHE_LIMIT = 50
const NETWORK_TIMEOUT_MS = 2500

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) =>
                cache.addAll([OFFLINE_URL, '/icon-192.png', '/icon-512.png']),
            )
            .then(() => self.skipWaiting()),
    )
})

// Open tabs of the previous build still load its chunks, so its caches stay until the next update.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => {
                const builds = keys.filter(
                    (key) => key !== CACHE && !key.endsWith('-pages'),
                )
                const previous = builds.at(-1)
                const keep = [CACHE, PAGES, previous, `${previous}-pages`]
                return Promise.all(
                    keys
                        .filter((key) => !keep.includes(key))
                        .map((key) => caches.delete(key)),
                )
            })
            .then(() => self.clients.claim()),
    )
})

self.addEventListener('message', (event) => {
    if (event.data?.type === 'clear-pages')
        event.waitUntil(
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys
                            .filter((key) => key.endsWith('-pages'))
                            .map((key) => caches.delete(key)),
                    ),
                ),
        )
})

self.addEventListener('push', (event) => {
    let message = {}
    try {
        message = event.data?.json() ?? {}
    } catch {}
    const { title, body, url, tag } = message
    event.waitUntil(
        self.registration.showNotification(title || 'Gripello', {
            body,
            tag,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: { url: url || '/' },
        }),
    )
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = new URL(
        event.notification.data?.url || '/',
        self.location.origin,
    ).href
    event.waitUntil(
        self.clients
            .matchAll({ type: 'window' })
            .then(([open]) =>
                open
                    ? open.focus().then((client) => client.navigate(url))
                    : Promise.reject(),
            )
            .catch(() => self.clients.openWindow(url)),
    )
})

self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    if (request.mode === 'navigate') {
        event.respondWith(
            networkFirst(
                request,
                PAGES,
                isPublicPage(url) && storablePage,
            ).then(
                async (response) =>
                    response ||
                    (await cachedGymRouteRedirect(url)) ||
                    (await caches.match(OFFLINE_URL)) ||
                    new Response('Offline', { status: 503 }),
            ),
        )
        return
    }

    const isRouteData = ROUTE_DATA.test(url.pathname)
    if (isRouteData || PUBLIC_DATA.test(url.pathname)) {
        // A late answer would only reach the cache, and live updates never correct a stale route list.
        const timeoutMs = isRouteData ? 0 : NETWORK_TIMEOUT_MS
        event.respondWith(
            networkFirst(
                request,
                isRouteData ? PAGES : CACHE,
                // Every search would add an entry; offline needs only the browsed lists.
                (response) => storable(response) && !url.searchParams.has('q'),
                timeoutMs,
            ).then((response) => response || Response.error()),
        )
        return
    }

    if (FILES.test(url.pathname) && !url.searchParams.has('token')) {
        event.respondWith(cacheFirst(request, trimFiles))
        return
    }

    if (
        url.pathname.startsWith('/_nuxt/') &&
        !url.pathname.startsWith('/_nuxt/builds/')
    )
        event.respondWith(cacheFirst(request))
})

// QR tags link /route?id=, which the server redirects into the gym; offline that redirect points at the stored gym page.
async function cachedGymRouteRedirect(url) {
    const id = url.searchParams.get('id')
    if (url.pathname !== '/route' || !id) return undefined
    const previous = (await caches.keys()).filter(
        (key) => key.endsWith('-pages') && key !== PAGES,
    )
    for (const name of [PAGES, ...previous]) {
        const cache = await caches.open(name)
        const stored = (await cache.keys()).find((request) => {
            const storedUrl = new URL(request.url)
            return (
                /^\/[^/]+\/route$/.test(storedUrl.pathname) &&
                storedUrl.searchParams.get('id') === id
            )
        })
        if (stored) return Response.redirect(stored.url, 302)
    }
    return undefined
}

function isPublicPage(url) {
    return PUBLIC_PAGE.test(url.pathname)
}

function storable(response) {
    return (
        response.ok &&
        !/no-store/i.test(response.headers.get('cache-control') || '')
    )
}

// Signed-in pages are no-store for the HTTP cache; PAGES is cleared on sign-out and user switch.
function storablePage(response) {
    return response.ok
}

function store(cacheName, request, response) {
    const copy = response.clone()
    return caches
        .open(cacheName)
        .then((cache) => cache.put(request, copy))
        .catch(() => {})
}

function cacheFirst(request, afterStore) {
    return caches.match(request).then(
        (cached) =>
            cached ||
            fetch(request).then((response) => {
                if (storable(response))
                    store(CACHE, request, response).then(afterStore)
                return response
            }),
    )
}

async function trimFiles() {
    const cache = await caches.open(CACHE)
    const files = (await cache.keys()).filter((key) =>
        FILES.test(new URL(key.url).pathname),
    )
    for (const key of files.slice(
        0,
        Math.max(0, files.length - FILE_CACHE_LIMIT),
    ))
        await cache.delete(key)
}

function networkFirst(
    request,
    cacheName,
    canStore = storable,
    timeoutMs = NETWORK_TIMEOUT_MS,
) {
    return new Promise((resolve) => {
        let settled = false
        const settle = (response) => {
            if (settled) return
            settled = true
            resolve(response)
        }
        const cached = () =>
            caches
                .open(cacheName)
                .then((cache) => cache.match(request))
                .then((response) => response || caches.match(request))
        const timer =
            timeoutMs &&
            setTimeout(async () => {
                const response = await cached()
                if (response) settle(response)
            }, timeoutMs)

        fetch(request)
            .then(async (response) => {
                clearTimeout(timer)
                if (response.status >= 500)
                    return settle((await cached()) || response)
                if (canStore && canStore(response))
                    store(cacheName, request, response)
                settle(response)
            })
            .catch(async () => {
                clearTimeout(timer)
                settle((await cached()) || null)
            })
    })
}
