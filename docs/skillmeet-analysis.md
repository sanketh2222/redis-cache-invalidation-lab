# Skillmeet HTML analysis — `cache-invalidation-v1`

Source file reviewed: `Skillmeet.html` (saved from `https://skillmeet.ai/exposure/cache-invalidation-v1`).  
The user referenced `Skillmeet(1).html`; this workspace contains `Skillmeet.html`, which matches the same canonical URL.

The page is a client-rendered SPA snapshot. Most UI chrome is present; detailed implementation specs (exact TTL seconds, key names, test harness code) are **not** in the static HTML.

---

## A. Explicitly stated by Skillmeet

These items are visible in the saved HTML body text.

| Topic | What Skillmeet states |
| --- | --- |
| Assessment slug | `cache-invalidation-v1` (canonical URL path) |
| Title | **Caching Strategy for a Slow API** |
| Tagline | Make a slow product API fast — and keep it consistent |
| Duration | **90 minutes** |
| Difficulty | **Intermediate** |
| Points | **75 points total** |
| Narrative | Platform engineer at **Synapse**; product catalog API P99 **800ms**; every request hits Postgres; pages re-fetch the same data many times |
| Core job | Add **Redis caching**, choose **eviction strategy**, handle **invalidation on product changes**, prove cache does **not serve stale data after writes** |
| Scoring model | **Four phases**, auto-checked against live environment; **hints cost points** |
| Phase 1 — Baseline & Hot Paths (15 pts) | Prove API is slow; **read-through cache on `GET /products/:id`**; measure **hit ratio** |
| Phase 2 — Cache Layer (20 pts) | Set correct **Redis eviction policy**; expose **cache-size metric to Prometheus**; keep **DB query rate low** (**stampede protection** + warm cache) |
| Phase 3 — Invalidation (25 pts) | **Invalidate cache on write**; **invalidate dependent list caches**; **cache negative results** |
| Phase 4 — Resilience | **Diagnose dual-write race condition**; **implement consistency fix**; final review: hit ratio, p99, memory |
| Skills listed | Cache Invalidation, Cache Eviction, Read-Through, Write-Through, Stampede Protection |
| Prerequisites | Basic Redis commands, Node.js fundamentals, HTTP basics |
| Environment (real assessment) | **11 containers**: 2 API replicas behind nginx LB, Redis, Postgres, Prometheus, Grafana, load-tester, abuse-simulator, workspace, dockersock-proxy |
| Dev experience | Browser terminals (no SSH), auto-save, 15-min inactivity timeout, network-isolated sessions |
| Observability | **Live Redis MONITOR stream tab** |
| Code location (real assessment) | Edits in `~/workspace/api-src/server.js` with `node --watch` reload |
| API stack (real assessment) | **Node.js API ×2** |

---

## B. Reasonable simulation assumptions

Introduced in `redis-cache-invalidation-lab` because the HTML does not include the private assessment repository.

| Assumption | Why |
| --- | --- |
| Single Node.js API process (not 2 replicas + nginx) | Optional **dual API** (`dev:api1`/`dev:api2`, Docker profile `dual-api` + nginx on `:8080`) |
| Express + `pg` + `redis` npm client | Matches Node.js prerequisite; easy to trace |
| Product domain with CRUD endpoints | Aligns with “product catalog API” narrative |
| Redis keys: `product:{id}`, `products:list`, `products:category:{category}` | Common catalog pattern; not stated in HTML |
| Postgres + Redis with configurable **maxmemory** / **maxmemory-policy**; optional API×2 profile |
| optional metrics counters in Redis | Prometheus-style **`GET /metrics`** on each API instance (in-process hit/miss counters) |
| Practice stages 1–7 map loosely to Skillmeet phases | User requested progressive local stages; numbering differs from Skillmeet’s 4 phases |
| Jest + `npm run evaluate` harness | Substitute for Skillmeet auto-checker (black-box behavioral checks) |
| Deterministic race/stampede tests via hooks | Real assessment likely uses load tests; hooks give reproducible local failures |
| `.env` configuration for URLs/TTL | Not specified in HTML |

---

## C. Unknowns

Cannot be determined from the saved HTML alone.

- Exact starter repository layout, file names, and frameworks beyond “Node.js API”
- Whether TypeScript is required
- Exact Redis key naming, TTL values, serialization format
- Which write endpoints exist (`PUT` vs `PATCH`, create/delete semantics)
- How hit ratio, p99 latency, and memory are measured in production checks
- Required Redis **maxmemory-policy** value (only “set the right policy” is stated)
- Prometheus metric names/labels for cache size
- Full definition and detection method for the **dual-write race** in the real grader
- Whether **write-through**, **write-behind**, or **cache-aside** is mandated per endpoint
- Abuse-simulator / rate-limit interactions
- Whether negative caching TTL or sentinel shape is specified
- Exact hint system and point deductions
- Database schema fields (e.g., optimistic locking/`version` column) in the real repo

---

## Mapping: Skillmeet phases → local practice stages

| Skillmeet phase | Local practice stages (see README) |
| --- | --- |
| Phase 1 | Stage 1 (cache-aside), partial Stage 2 (TTL) |
| Phase 2 | Stage 2 (TTL), Stage 6 (stampede), optional metrics |
| Phase 3 | Stage 3–5 (invalidation, dependent keys, negative cache) |
| Phase 4 | Stage 7 (stale write race / consistency) |

This mapping is for **practice only**, not an official Skillmeet specification.
