// k6 load test for the read-heavy core (docs/04 §3 non-functional). It logs in
// once (via the mock IdP) to obtain a session, then hammers the catalog-read
// path the way real traffic does — GET /api/catalog (cache-served), with a
// sprinkle of /api/me and /api/favorites.
//
// Run (needs k6, the app running with OIDC pointed at the mock, seeded catalog):
//   BASE=http://localhost:8080 k6 run deploy/loadtest/catalog.js
//
// Target (docs/02 §9): ~2–3k concurrent, p95 well under the threshold below, on a
// single instance. Catalog reads never touch the DB (in-process cache); session
// validation is an indexed per-request lookup.

import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE || 'http://localhost:8080'

export const options = {
  scenarios: {
    catalog_reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 3000 },
        { duration: '2m', target: 3000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<300'], // p95 under 300ms
    'http_req_duration{endpoint:catalog}': ['p(95)<150'], // cache-served reads are fast
  },
}

// setup logs in once and returns the session cookie for all VUs to reuse.
export function setup() {
  const jar = http.cookieJar()
  http.get(`${BASE}/auth/login`, { redirects: 10 })
  const cookies = jar.cookiesForURL(BASE)
  const session = cookies.sh_session && cookies.sh_session[0]
  if (!session) {
    throw new Error('login failed — no session cookie (is OIDC wired to the mock?)')
  }
  return { cookie: `sh_session=${session}` }
}

export default function (data) {
  const params = { headers: { Cookie: data.cookie } }

  const cat = http.get(`${BASE}/api/catalog`, Object.assign({ tags: { endpoint: 'catalog' } }, params))
  check(cat, { 'catalog 200': (r) => r.status === 200 })

  // Lighter mix of the other authenticated reads.
  if (Math.random() < 0.3) {
    check(http.get(`${BASE}/api/me`, params), { 'me 200': (r) => r.status === 200 })
  }
  if (Math.random() < 0.2) {
    check(http.get(`${BASE}/api/favorites`, params), { 'favorites 200': (r) => r.status === 200 })
  }
  sleep(1)
}
