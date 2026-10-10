import http from 'k6/http'
import { check, sleep } from 'k6'

// k6 run -e BASE=http://localhost:8080 -e GYM=<slug> -e EMAIL=... -e PASSWORD=... backend/loadtest/k6.js
const BASE = __ENV.BASE || 'http://localhost:8080'
const GYM = __ENV.GYM
const VUS = Number(__ENV.VUS || 1500)

export const options = {
    scenarios: {
        browse: {
            executor: 'constant-vus',
            vus: Math.round(VUS * 0.8),
            duration: '5m',
            exec: 'browse',
        },
        climb: {
            executor: 'constant-vus',
            vus: Math.round(VUS * 0.2),
            duration: '5m',
            exec: 'climb',
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<300'],
        checks: ['rate>0.99'],
    },
}

export function setup() {
    const res = http.post(
        `${BASE}/api/auth/login`,
        JSON.stringify({ identity: __ENV.EMAIL, password: __ENV.PASSWORD }),
        { headers: { 'Content-Type': 'application/json' } },
    )
    const routes = http
        .get(`${BASE}/api/gyms/${GYM}/routes?limit=50`)
        .json('items')
    return { token: res.json('token'), routeIds: routes.map((r) => r.id) }
}

function pick(list) {
    return list[Math.floor(Math.random() * list.length)]
}

export function browse(data) {
    check(http.get(`${BASE}/api/gyms/${GYM}/routes?limit=50&include=wall`), {
        'routes 200': (r) => r.status === 200,
    })
    check(http.get(`${BASE}/api/routes/${pick(data.routeIds)}`), {
        'route 200': (r) => r.status === 200,
    })
    check(http.get(`${BASE}/api/routes/${pick(data.routeIds)}/ratings`), {
        'ratings 200': (r) => r.status === 200,
    })
    check(http.get(`${BASE}/api/gyms/${GYM}/leaderboard`), {
        'board 200': (r) => r.status === 200,
    })
    sleep(3 + Math.random() * 5)
}

export function climb(data) {
    const headers = {
        Authorization: `Bearer ${data.token}`,
        'Content-Type': 'application/json',
    }
    const tick = http.post(
        `${BASE}/api/me/ticks`,
        JSON.stringify({
            route: pick(data.routeIds),
            type: 'top',
            attempts: 2,
            date: new Date().toISOString(),
        }),
        { headers },
    )
    check(tick, { 'tick 201': (r) => r.status === 201 })
    if (tick.status === 201) {
        http.del(`${BASE}/api/ticks/${tick.json('id')}`, null, { headers })
    }
    check(http.get(`${BASE}/api/me/ticks?limit=20`, { headers }), {
        'logbook 200': (r) => r.status === 200,
    })
    sleep(10 + Math.random() * 10)
}
