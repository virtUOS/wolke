# Load test

`catalog.js` is a [k6](https://k6.io) test of the read-heavy core (docs/04 §3):
it logs in once via the mock IdP, then drives `GET /api/catalog` (cache-served)
with a light mix of `/api/me` and `/api/favorites`, ramping to ~3k VUs.

## Prerequisites

- `k6` installed.
- The app running with OIDC wired to the mock and a seeded catalog:
  `make idp && make db && make migrate && make seed`, then `make serve`
  (with `OIDC_*` in `.env`). The mock's `interactiveLogin:false` lets `setup()`
  log in non-interactively.

## Run

```bash
BASE=http://localhost:8080 k6 run deploy/loadtest/catalog.js
```

## Thresholds (the gate, docs/02 §9)

- `http_req_failed < 1%`
- overall `p95 < 300ms`; catalog-read `p95 < 150ms` (in-process cache)

If catalog-read p95 climbs under load, the bottleneck is most likely per-request
session validation (an indexed DB lookup), not the catalog cache — that's the
first thing to profile, and the trigger for the multi-instance + Redis path in
docs/02 §9.
