# Skillmeet analysis coverage audit

Maps **Section A** requirements from `docs/skillmeet-analysis.md` to **redis-cache-invalidation-lab**.

| Skillmeet requirement (explicit) | Practice simulation |
| --- | --- |
| Read-through cache on `GET /products/:id` | Implemented (starter); evaluator checks hit/miss |
| Measure hit ratio | `GET /metrics` → `cache_hit_ratio`, counters |
| Redis eviction policy | `REDIS_MAXMEMORY` + `REDIS_MAXMEMORY_POLICY` in compose; verify via `CACHE_EVICTION_POLICY_TARGET` |
| Cache-size metric to Prometheus | `cache_estimated_bytes`, `cache_keys_count`, `redis_memory_used_bytes` on `/metrics` |
| Stampede protection + warm cache | Tests/evaluator FAIL until implemented; `POST /admin/cache/warm` + env configuration |
| Invalidate on write / list / negative | Starter incomplete; evaluator FAIL |
| Dual-write race + consistency fix | **Simulated** via hooks — see `docs/stage7-dual-write-simulation.md` |
| Final review: hit ratio, p99, memory | Evaluator: metrics ratio, `load-test.js` percentiles, Redis INFO |
| Node.js API ×2 | `npm run dev:api1` / `dev:api2`, Docker profile `dual-api` + nginx `:8080` |
| Prometheus (real env) | Local `GET /metrics` text exposition (no separate Prometheus container) |
| 11-container stack | Not replicated; core Redis/Postgres/API×2/LB/load-test script only |

Items in **Section C** (unknown exact grader behavior) remain unknown; this repo does not claim parity.
