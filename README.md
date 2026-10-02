# redis-cache-invalidation-lab

Local simulation of the Skillmeet **cache-invalidation-v1** engineering assessment. The codebase is a small product catalog API with Redis caching that is **intentionally incomplete** in invalidation, TTL, negative caching, concurrency, and consistency areas.

This is a practice environment — not a tutorial with finished answers.

## Setup

```bash
cd redis-cache-invalidation-lab
npm install
cp .env.example .env
docker compose up -d
npm run migrate
npm run seed
npm run dev
```

API default: `http://localhost:3000`

## Running tests

```bash
npm test
```

## Running evaluator

```bash
npm run evaluate
```

## Load test (P50 / P95 / P99)

```bash
npm run load-test -- --url http://localhost:3000 --path /products/1 --requests 200 --concurrency 20
```

## Dual API instances (shared Redis/Postgres)

```bash
npm run dev:api1   # :3000  INSTANCE_ID=api-1
npm run dev:api2   # :3001  INSTANCE_ID=api-2
```

Or Docker: `npm run compose:dual` (LB on `http://localhost:8080`).

## Observability & Redis tuning

- `GET /metrics` — Prometheus text format (hits, misses, hit ratio, cache bytes, Redis memory)
- Redis eviction: set `REDIS_MAXMEMORY` and `REDIS_MAXMEMORY_POLICY` in `.env` / docker compose
- After you **choose** a policy, set matching `CACHE_EVICTION_POLICY_TARGET` for evaluator verification
- Cache warming: configure `CACHE_WARM_PRODUCT_IDS`, implement `src/services/cacheWarmer.js`, call `POST /admin/cache/warm`

Stage 7 race is a **local simulation** — read `docs/stage7-dual-write-simulation.md` (not Skillmeet's private grader).

The evaluator runs black-box checks against temporary server instances and prints `PASS` / `FAIL` lines with behavioral details.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness (+ instance id) |
| GET | `/metrics` | Prometheus metrics scrape |
| GET | `/products` | List products (optional `?category=`) |
| GET | `/products/:id` | Product detail |
| POST | `/products` | Create product |
| PUT | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product |
| POST | `/admin/cache/warm` | Run configured cache warm (stub until you implement it) |
| GET | `/debug/db-query-count` | Test helper: DB query counter |
| POST | `/debug/db-query-count/reset` | Reset DB query counter |

## Architecture

```text
HTTP Request
    ↓
routes/products.js
    ↓
controllers/productController.js
    ↓
services/productService.js
    ↓
services/cacheService.js  ↔  Redis
    ↓
repositories/productRepository.js
    ↓
PostgreSQL
    ↓
HTTP Response
```

Entry point: `src/server.js`  
Main cache logic: `src/services/cacheService.js`  
Business flow: `src/services/productService.js`

## Redis keys

| Key | Purpose |
| --- | --- |
| `product:{id}` | Cached product detail JSON |
| `products:list` | Cached full list |
| `products:category:{category}` | Cached category list |
| `product:missing:{id}` | Negative cache marker |
| `metrics:*` (legacy) | Optional Redis counters — primary metrics are on `GET /metrics` |

See `docs/redis-practice.md` for hands-on Redis exercises.

## Practice stages

1. **Basic cache-aside** — detail GET should hit Redis after first load.
2. **TTL** — detail keys expire; list keys should too.
3. **Cache invalidation** — PUT/DELETE must not leave stale detail entries.
4. **Dependent invalidation** — list/category keys must track mutations.
5. **Negative caching** — missing ids should not hammer Postgres.
6. **Stampede** — parallel misses should not each query the database.
7. **Stale write race (simulated dual-write)** — see `docs/stage7-dual-write-simulation.md`

Work through stages in order. Use `npm run evaluate` after each stage.

## Rules

**Do**

- Trace requests from route → service → Redis → DB.
- Use redis-cli / MONITOR to inspect keys.
- Run tests and evaluator frequently.
- Ask Cursor questions; treat this like an unfamiliar repo.

**Do not**

- Read `docs/reference/solution-notes.md` until after you attempt a stage.
- Assume failing tests are bugs in the test harness — many failures are expected initially.

## Postman

Import `postman/redis-cache-invalidation-lab.postman_collection.json` into Postman (all API endpoints from the table below).

## Related docs

- `docs/skillmeet-analysis.md` — what the saved Skillmeet HTML actually states
- `docs/redis-practice.md` — manual Redis exercises
- `docs/audit-skillmeet-coverage.md` — requirement traceability to this repo
