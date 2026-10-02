# Simulation guide

Recommended order to practice the assessment experience.

## 0. Orient (15 min)

1. Read `README.md` and `docs/skillmeet-analysis.md` section **A** only.
2. Start Docker, migrate, seed, run the API.
3. Hit `GET /products/1` twice; reset and inspect `/debug/db-query-count`.

## 1. Map the codebase (20 min)

1. Open `src/routes/products.js` → controller → `productService` → `cacheService` → repository.
2. List Redis keys from `src/redis/keys.js`.
3. Run `redis-cli -p 6380 MONITOR` while calling endpoints.

## 2. Stage 1 — Cache-aside

1. Run `npm test -- tests/cache/cache-aside.test.js`.
2. Confirm cache hit avoids DB; miss populates Redis.
3. Run `npm run evaluate` and note which checks already pass.



## 3. Stage 2 — TTL

1. Run TTL tests.
2. Inspect `TTL product:1` vs `TTL products:list` after list fetch.
3. Fix only TTL-related gaps; re-run evaluator.



## 4. Stage 3 — Write invalidation

1. Warm cache, `PUT /products/:id`, compare HTTP vs Redis.
2. Run invalidation tests.
3. Implement mutation invalidation; re-run evaluator.



## 5. Stage 4 — Dependent keys

1. Warm `GET /products` and category list.
2. Mutate a product; detect stale list payloads.
3. Extend invalidation to related keys.

