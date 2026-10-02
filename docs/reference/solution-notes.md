# Reference notes (after you attempt the stages)

Do not read this until you have tried the stage yourself.

---

## Stage 1 — Cache-aside

Starter code already implements basic read-through for `GET /products/:id` via `productService.getProductById` → `cacheService.getCachedProduct` / `setCachedProduct`.

Verify with `/debug/db-query-count` or Jest `cache-aside.test.js`.

---

## Stage 2 — TTL

Detail keys use `EX` in `setCachedProduct`. List/category keys intentionally omit TTL in the starter (`setCachedList`, `setCachedCategoryList`).

Expired detail keys should naturally miss in Redis; ensure you do not refresh TTL on hits unless requirements say so.

---

## Stage 3 — Invalidation on write

`invalidateProductCaches` is currently a **no-op stub**.

On `PUT` / `DELETE` you typically need to:

- Delete or overwrite `product:{id}`
- Delete `product:missing:{id}` if present
- Invalidate `products:list`
- Invalidate old and new `products:category:{category}` when category changes

---

## Stage 4 — Dependent list caches

Even if detail cache is fixed, list endpoints can remain stale if `products:list` survives mutations.

Tests compare list payload vs fresh detail after `PUT`.

---

## Stage 5 — Negative caching

Wire `getNegativeCache` / `setNegativeCache` in `getProductById` when DB returns null.

Remember to invalidate negative entries when a product is created with that id (unlikely) or when assessing 404 after delete.

---

## Stage 6 — Stampede protection

Without coalescing, parallel misses each call `findById`.

Common approaches:

- In-process `Map` of in-flight promises (single instance)
- Redis lock: `SET lock:product:{id} NX EX 5` + retry/backoff
- Request coalescing layer around DB fetch

Evaluator expects ≤3 DB queries for 25 parallel misses (tunable).

---

## Stage 7 — Stale write race

Flow in tests:

1. Slow GET miss reads DB vN, pauses before cache SET (hook).
2. Concurrent update writes vN+1 to DB and cache.
3. Slow GET completes and must **not** downgrade Redis to vN.

Fix patterns:

- Compare `version` (or `updated_at`) before SET
- Use `GET` + conditional write (`WATCH`/`MULTI` or Lua)
- Delete cache instead of blind SET on read path after miss

Relevant Redis: `SET`, `GET`, `DEL`, `SET NX`, `WATCH`.

---

## Skillmeet-only topics (not fully simulated locally)

- Redis **maxmemory-policy** tuning at the server level
- Prometheus metric exposition format
- Dual API replicas behind nginx (cross-pod consistency)
- P99 latency under load tester

---

## Expected evaluator outcomes (starter codebase)

| Check | Starter expectation |
| --- | --- |
| Redis connection | PASS |
| Cache hit / miss basics | PASS |
| Detail cache after PUT | FAIL |
| List invalidation | FAIL |
| Detail TTL | PASS |
| List TTL | FAIL |
| Negative cache | FAIL |
| Stampede protection | FAIL |
| Stale write protection | FAIL |

Your goal is to turn FAIL → PASS without breaking earlier checks.
