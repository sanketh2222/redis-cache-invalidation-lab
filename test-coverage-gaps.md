# Test coverage gaps

Repo: redis-cache-invalidation-lab @ `af0f3ac` (origin/main). This list describes test gaps only. It does not contain fixes. "(not implemented yet)" means the behavior doesn't exist in the code yet, so the test would be expected to fail until it does.

## 1. Negative cache / not-found poisoning
- **No test covers the negative cache together with create at all.** `tests/products/negative-cache.test.js` only checks that a missing id (99999) returns 404 twice, makes 0 DB queries the second time, and that `product:missing:99999` exists. Why it matters: `createProduct` (productService.js) never deletes `keys.negativeProduct(created.id)`. Assertion: GET `/products/<next id>` → 404, then POST (it gets that id because of SERIAL), then `redis.exists('product:missing:<id>')` should be `0`. Today it is `1`, TTL 30 (checked by hand).
- **The detail-cache write hides the not-found key instead of deleting it.** `createProduct` calls `setCachedProduct(created)` (60s TTL), and `getProductById` checks `product:<id>` before `getNegativeCache`. The stale `product:missing:<id>` (30s) is still there underneath. Why it matters: the result depends on timing, not on correctness. If the detail key is evicted, deleted, or expires early, the stale 404 comes back. Assertion: after create, DEL `product:<id>` (to simulate eviction), then GET `/products/<id>` should be 200 and should query the DB. Today it returns 404 (checked by hand).
- **Concurrent create while not-found is cached.** Run a GET for id N (DB miss, about to call `setNegativeCache`) alongside a POST that creates N. Use `hooks.afterDbRead` on `findById` to hold the GET after its DB miss until the create finishes. Why it matters: the in-flight GET writes `product:missing:N` *after* the create, which poisons N for 30s. Assertion: after both finish, `exists(product:missing:N) === 0` and GET → 200.
- **Create failing partway.** If `productRepository.create` succeeds but `flushProductListCaches` / `setCachedProduct` / `getCachedList` / `setCachedCategoryList` throws, the API returns 500 even though the row was committed. Assertion: stub a cache call to reject, then check (a) the HTTP status and body, (b) that the row exists in the DB, (c) whether the not-found, list, and category keys are left stale, and (d) that an error was logged. No logging exists on this path (not implemented yet).
- **Delete then GET fills the negative cache, and update/delete flush it as a side effect.** `invalidateProductCaches` → `flushAllProductCacheKeys` uses SCAN on `product:*`, which also matches `product:missing:*`. So any PUT or DELETE wipes every negative entry. No test asserts this either way. Assertion: seed `product:missing:99999`, PUT `/products/1`, check `exists` (this documents the current over-flush, so a later narrowing of invalidation can't silently change it without a test noticing). Also: DELETE, then GET → 404 should leave `product:missing:<id>` with a TTL of about 30.
- **Create-delete-recreate with the same id isn't actually tested.** Ids come from SERIAL, so the API never reuses one. The real reuse path is `resetFixtures` (`TRUNCATE … RESTART IDENTITY`), which doesn't touch Redis. Assertion: cache `product:5` / `product:missing:5`, run resetFixtures, then create, then GET 5 should return the new row and not the old cached row or a 404. (In tests, flushes in `startTestServer` and `beforeEach` hide this.)
- **Id reuse across item types: N/A.** There is only one entity (`products`), and `keys.js` has no type prefix other than `product:missing:`.
- **Negative-entry TTL is never checked.** No test runs `redis.ttl('product:missing:<id>')`. Assertion: TTL is > 0 and ≤ `config.negativeCacheTtlSeconds` (30), and it's lower than the detail TTL. Also: after expiry (run with a short `NEGATIVE_CACHE_TTL_SECONDS`), the next GET queries the DB again.
- **Negative cache filled by another code path: the warmer.** `warmConfiguredCache` calls `productService.getProductById(id)`, so a configured id that doesn't exist (for example `CACHE_WARM_PRODUCT_IDS=1,99999`) writes `product:missing:99999`. Assertion: after POST `/admin/cache/warm`, check which `product:missing:*` keys exist and their TTLs.
- **Invalid ids.** `getProductById` throws 400 for `0`, `-1`, `abc`, and `1.5`. No test checks that these return 400, make no DB query, and leave no `product:missing:*` key.

## 2. Category list caching / invalidation
- **The category list isn't tested anywhere.** No Jest test or evaluator check calls GET `/products?category=…`. `listProductsByCategory`, `getCachedCategoryList`, and `setCachedCategoryList` have zero coverage.
- **Add: the category list goes stale after create.** `createProduct` flushes only `products:list`, then reads `getCachedList()` right after. That read always returns null, so the category refresh never runs. Assertion: warm `?category=electronics` (2 items), POST to electronics, then GET category should show 3. Today it shows 2 until the TTL runs out (checked by hand).
- **Empty-list caching.** `'[]'` is a truthy string and `[]` is a truthy value, so an empty category result is cached and served for 60s. Assertion: GET `?category=newcat` → `[]`, POST to newcat, then GET should include the new item, and `products:category:newcat` should be absent or correct. Today it stays `[]` (checked by hand). Do the same for an empty `products:list`.
- **Update that changes category (old vs new).** `updateProduct` passes `existing.category` and `updated.category` to `invalidateProductCaches`, which ignores them and flushes everything. No test warms both category lists, moves a product, and checks that it left the old list and joined the new one. Assertion: both `products:category:<old>` and `<new>` are gone (or correct) after PUT, and both GETs match the DB.
- **Update that keeps the same category (price/name change).** No test checks that the category list payload shows the new price after PUT.
- **Delete.** No test checks that a deleted product drops out of `products:list` or `products:category:<cat>` (`invalidation.test.js` only checks the `product:<id>` detail key).
- **Partial invalidation.** If invalidation ever narrows to per-key deletes (see the TODO in `invalidateProductCaches`), no test proves that unrelated keys survive (for example `products:category:home` after a stationery change) or that every dependent key is cleared. Assertion: list all keys before and after a mutation and compare against an expected set.
- **Concurrent category mutations.** Two parallel POSTs/PUTs in the same category, or a PUT moving A→B while another moves B→A. Assertion: after both finish, every category GET equals `findByCategory` from the DB.
- **List reads during invalidation.** A GET `?category=X` that reads the DB before a mutation and writes the cache after the invalidation leaves a stale list behind. No hook exists for list reads (`findAll` / `findByCategory` don't call `runHook`), so this can't be tested deterministically today (not implemented yet). Assertion: after the race, the category key is absent or matches the DB.
- **Read-modify-write in `createProduct`.** If a concurrent GET `/products` refills `products:list` between `flushProductListCaches` and `getCachedList`, the filter block *does* run, using a list that may or may not include the new product. Assertion: force that interleaving, then check the category list payload against the DB.
- **Category key edge cases.** Categories with glob characters (`*`, `?`, `[`): `flushProductCategoryListCaches` passes the raw category as the SCAN MATCH pattern, so `elec*` would match other categories' keys. Also case and whitespace differences, and `?category=` (empty, which falls back to the full list). None are tested.

## 3. Stampede protection (not implemented yet)
- **Thundering herd on a cold key.** Both `stampede.test.js` (40 requests, ≤3) and the evaluator (25 requests, ≤3) only count DB queries. With no coalescing, local runs gave 4–5 queries in Jest and 17 in the evaluator, so the test only *barely* fails. It can pass by accident if the HTTP client serializes requests. Assertion: gate the first `findById` with `hooks.afterDbRead` so every request is guaranteed in flight before the cache is filled, then expect exactly 1 `findById`.
- **Stampede on a missing id.** No test sends N parallel GETs for a non-existent id. Assertion: 1 DB query, then one negative key.
- **Stampede on list/category keys.** `listProducts` and `listProductsByCategory` have no coverage for parallel cold reads. Assertion: `findAll` / `findByCategory` count = 1.
- **Stampede during invalidation.** A PUT flushes everything, then N parallel GETs arrive. Assertion: low DB count, and every response matches the post-PUT version.
- **Single-flight when the backing call errors.** If the leader's DB call rejects, followers should get the error (or retry) instead of hanging or getting a cached null. Assertion: all requests finish within a timeout, no `product:<id>` or `product:missing:<id>` is written, and the next request after recovery succeeds.
- **Lock timeout and release.** If a lock or lease is added: the lock key has a TTL, it's released on success *and* on error, a crashed holder doesn't block the key past the TTL, and a lock isn't released by a non-owner. Assertion: `exists`/`ttl` on the lock key during and after the request.
- **Cross-instance stampede.** The evaluator starts two instances, but the stampede check only hits instance A. No test splits parallel misses across A and B (in-process coalescing alone wouldn't cover that).

## 4. Stale writes / races
- **The read-repopulates-stale race through the real PUT path.** `race.test.js` and the evaluator simulate the writer with `productRepository.update` + `setCachedProduct` directly. They never cover GET (holds the old row via `afterDbRead`) → PUT (DB update + `invalidateProductCaches` flush) → GET resumes and `setCachedProduct(old)`. Assertion: after release, `product:<id>.version === DB version`, or the key is absent. Currently failing in its existing form (cached version 1 vs 2 in Jest).
- **Read-your-writes.** Only immediate GET-after-PUT is checked (detail and full list). There's nothing for GET-after-POST on detail or category, GET-after-DELETE on lists, or a write on instance A followed by a read on instance B.
- **Two concurrent writers.** Parallel PUTs to the same id. Assertion: the cached version equals the highest DB version, and an older write never overwrites a newer one.
- **Cache update ordering in `createProduct`.** It runs flush list → set detail → read list → maybe set category. No test checks the final key state after interleaving with a concurrent PUT or DELETE of the same id (for example, a DELETE between `create` and `setCachedProduct` leaves a ghost `product:<id>` for 60s).
- **Update/delete TOCTOU (time-of-check, time-of-use).** `updateProduct` and `deleteProduct` call `findById`, then mutate. If the row is deleted in between, `update` returns null and `updated.id` throws (500). Covered in `tests/concurrency/update-toctou.test.js` (sequential case passes; concurrent PUT-vs-DELETE is `test.failing` until fixed). See glossary in `docs/redis-practice.md`.
- **Version semantics.** `setCachedProduct` has the comment "no version check on write". No test checks that `beforeCacheSet`/`afterCacheSet` hooks fire, or that a lower-version write is rejected (not implemented yet).

## 5. Error / fallback paths
- **Redis down.** `tests/cache/redis-failure.test.js` is a placeholder (`expect(true)`). Nothing tests GET, list, or mutations when `getRedis()` rejects or the client errors mid-request (not implemented yet). Assertion: point `REDIS_URL` at a dead port or close the client, then GET `/products/1` should be 200 from the DB (if graceful degradation is the target) or a clean 5xx, and mutations should still commit.
- **Redis timeout or slow commands.** There's no timeout config in `redis/client.js` and no test of request latency when Redis hangs.
- **Serialization failures.** `deserialize` swallows bad JSON and returns null. Cases:
  - Corrupt `product:1`: `getCachedProduct` returns `{hit:true, product:null}`, counts a *hit* in metrics, then falls through to the DB. GET returns 200 (checked by hand).
  - Corrupt `products:list` or category key: these act as misses.
  - Assertion: status, body, whether the corrupt key is overwritten, and that `cache_hits_total` is unchanged.
- **Partial failure mid-invalidation.** If `flushAllProductCacheKeys` throws after the DB write, PUT/DELETE return 500 even though the DB changed. Assertion: DB state, HTTP status, which keys are left, and that something was logged.
- **Logging.** No test checks any log output. `invalidateProductCaches` only logs at debug, and cache-failure paths log nothing (not implemented yet). Assertion: spy on `logger.error`/`warn` when a cache operation fails.
- **Metrics on failure.** `/metrics` returns 500 when Redis is unreachable (app.js). Not tested.

## 6. Cache contents vs HTTP-only assertions
- `cache-aside.test.js` "miss populates" never checks that `product:1` exists (it only checks the DB count ≥ 1), and never checks the cached payload against the DB.
- `invalidation.test.js` "PUT/POST invalidates list" only checks the HTTP list. No test checks whether `products:list`, `products:category:*`, or `product:missing:<id>` exist right after a mutation.
- TTL checks only cover `ttl > 0` for `product:1` and `products:list`. Missing:
  - an upper bound (≤ `productCacheTtlSeconds`),
  - category key TTL,
  - negative key TTL (≤ 30),
  - created-product detail TTL,
  - that `setCachedProduct` after create doesn't leave a key with no expiry (`ttl !== -1`).
- No test asserts the full keyspace (SCAN `product:*` / `products:*`) after each operation. A snapshot would catch over-flushing, leftover keys, and new keys with no TTL.

## 7. Concurrency / load
- The only concurrency tests are the stampede count and one hook-gated race. There's no randomized mixed workload (parallel GET/PUT/POST/DELETE across ids and categories) that ends with "every cached key equals the DB row or is absent".
- `scripts/load-test.js` is used by the evaluator only to check that p50/p95/p99 > 0. There's no assertion on error rate, hit ratio under load, or DB query count per N requests.
- No two-instance concurrency test beyond the single shared-cache read (`runSharedCacheCheck`).

## 8. Implemented but never tested
- **The warmer (`cacheWarmer.js`).** `warmConfiguredCache` always returns `warmed: []` (the evaluator check fails) and ignores `includeList`. It double-writes the detail key (once via `getProductById`, once via `setCachedProduct`). Gaps:
  - `parseWarmProductIds` filtering (spaces, `0`, `-1`, `abc`, duplicates),
  - the 501 response when the ids are empty,
  - `maybeWarmOnStartup` with `CACHE_WARM_ON_STARTUP=1`,
  - key and TTL assertions after warming.
- **SCAN flush helpers.**
  - `flushProductCategoryListCaches` is never called by the app or the tests.
  - `flushProductListCaches` is only exercised indirectly through POST.
  - `flushAllProductCacheKeys` is used as test setup but never asserted on its own: that it also removes `product:missing:*`, that it doesn't touch `metrics:*`, and that it works when there are more than 100 keys (paging with SCAN COUNT).
- **Unused key helpers.** `keys.dbQueryCounter` / `cacheHits` / `cacheMisses` (`metrics:*`) aren't used anywhere. The real counters are in-process (`dbMetrics.js`, `prometheus.js`), so they're per instance and reset on restart. Untested.
- **Metrics detail.**
  - `metrics-endpoint.test.js` only checks that metric names appear.
  - Nothing tests `cache_list_hits_total`/`misses` values, `cache_keys_count`, or `cache_estimated_bytes` accuracy.
  - Nothing tests the spurious list miss that `createProduct`'s `getCachedList()` adds.
  - `resetMetricsForTests` is never used, so counters leak between test files.
- **Startup and config.** Nothing tests `server.js` startup (Redis connect failure → exit 1), the env defaults in `config.js` (TTLs 60/30), `CACHE_EVICTION_POLICY_TARGET` (empty, so the evaluator check fails), or the `maxmemory`/policy effect on eviction (which ties into the hidden-not-found risk above).
- **Validation.** POST missing name/price/category → 400, `price` that isn't a number (`Number('abc')` = NaN goes into the DB), and PUT/DELETE on a missing id → 404 with no cache side effects. None are tested.

## Known-bad / misleading tests
- `tests/concurrency/stampede.test.js`: unreliable. With no coalescing implemented it gets 4–5 DB queries for 40 requests against a ≤3 threshold, so small timing changes can make it pass without any stampede protection. It also asserts nothing about response bodies.
- `tests/cache/redis-failure.test.js`: a placeholder (`expect(true).toBe(true)`). It covers nothing.
- `tests/evaluation/evaluator-smoke.test.js`: asserts the evaluator prints `FAIL` and exits 1, so it **will fail once every evaluator check passes**. It's coupled to the starter state.
- `tests/concurrency/race.test.js` and the evaluator race check: they bypass the PUT/invalidation path (they call the repository and `setCachedProduct` directly), so they don't cover the invalidate-then-stale-repopulate race.
- `ttl.test.js`: the test name still says "currently missing in starter code" even though the list TTL now exists.
