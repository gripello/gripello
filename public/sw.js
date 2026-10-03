const BUILD = new URL(self.location.href).searchParams.get('build')
const CACHE = `gripello-${BUILD}`
const PAGES = `${CACHE}-pages`
const OFFLINE_URL = '/offline.html'
const PUBLIC_DATA =
    /^\/(_i18n\/|api\/collections\/(walls|locations|averageRating|open_route_defects)\/records$)/
const FILES = /^\/api\/files\//
const FILE_CACHE_LIMIT = 50
const NETWORK_TIMEOUT_MS = 4000

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

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE && key !== PAGES)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    )
})

self.addEventListener('message', (event) => {
    if (event.data?.type === 'clear-pages')
        event.waitUntil(caches.delete(PAGES))
})

self.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) return

    if (request.mode === 'navigate') {
        event.respondWith(
            networkFirst(request, PAGES).then(
                async (response) =>
                    response ||
                    (await caches.match(OFFLINE_URL)) ||
                    new Response('Offline', { status: 503 }),
            ),
        )
        return
    }

    if (PUBLIC_DATA.test(url.pathname)) {
        event.respondWith(
            networkFirst(request, CACHE).then(
                (response) =>
                    response || new Response('Offline', { status: 503 }),
            ),
        )
        return
    }

    if (FILES.test(url.pathname)) {
        event.respondWith(cacheFirst(request, trimFiles))
        return
    }

    if (
        url.pathname.startsWith('/_nuxt/') &&
        !url.pathname.startsWith('/_nuxt/builds/')
    )
        event.respondWith(cacheFirst(request))
})

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
                if (response.ok)
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

function networkFirst(request, cacheName) {
    return new Promise((resolve) => {
        let settled = false
        const settle = (response) => {
            if (settled) return
            settled = true
            resolve(response)
        }
        const cached = () => caches.match(request)
        const timer = setTimeout(async () => {
            const response = await cached()
            if (response) settle(response)
        }, NETWORK_TIMEOUT_MS)

        fetch(request)
            .then((response) => {
                clearTimeout(timer)
                if (response.ok) store(cacheName, request, response)
                settle(response)
            })
            .catch(async () => {
                clearTimeout(timer)
                settle((await cached()) || null)
            })
    })
}
