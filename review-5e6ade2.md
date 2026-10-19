# Review of commit 5e6ade2: Redis-lock single-flight for GET /products/:id

Files: `src/services/singleFlight.js` (new), `src/services/productService.js`, `tests/concurrency/stampede.test.js`.

## Headline

The commit fixes the cache stampede on GET-by-id. It does **not** close the stale-write race (Stage 7 / SkillMeet 4.1). They are separate problems.

## What holds up

- One leader takes `lock:product:<id>` with `SET NX`, a random UUID token, and a 30-second expiry (`PX 30000`).
- The leader checks the cache again after taking the lock, so a request that loses the race doesn't reload from the DB.
- The lock is released in a `finally` block with a Lua compare-and-delete, so one request can't delete another request's lock after expiry.
- Waiters poll the cache with exponential backoff (25 ms to 500 ms) plus jitter.
- Missing ids are covered: the leader writes the negative-cache key, and waiters return `null` when they see it.
- Every GET-by-id now goes through `getWithSingleFlight`. No path bypasses it.
- Both coalescing tests pass against live Postgres and Redis (one DB read for an existing product; one DB read and one negative key for a missing id).

## Main issue: the stale-write race is still open

1. The leader misses, takes the lock, and reads the **old** row from the DB.
2. A PUT commits the new row and `invalidateProductCaches` clears the cache.
3. The leader then runs `setCachedProduct` with the old row, writing stale data back into Redis.
4. That stale row stays until the TTL expires.

Why it's still open: `updateProduct` never takes the lock, and nothing checks the version before the SET. Fixing it needs separate Stage 7 work, for example a version or timestamp compare-and-set before writing, or a delayed second delete after the update.

## Other risks (in priority order)

1. **Leader failure causes a delayed herd.** If `loadAndCache` throws, only the leader's request fails. Waiters aren't told, so they keep polling for up to 25 s (`maxWaitMs`) and then all fall back to the DB at once.
2. **Lock expiry with no fencing.** If a load takes longer than 30 s, the lock expires and a second leader starts. There's no lock extension or fencing token.
3. **Redis down throws instead of falling back.** `acquireLock` and `tryReadCache` throw when Redis is unavailable, rather than reading straight from the DB. The old code behaved the same, so this isn't a regression, but it isn't fail-open.
4. **No in-memory dedupe.** There's no per-process Map of id to Promise in front of the Redis lock, so every concurrent miss in one process makes its own Redis round trips: a lock attempt, then two GETs per poll.
5. **List and category routes are unprotected.** `listProducts` and `listProductsByCategory` have no single-flight.

## What the tests don't cover

- Leader failure (waiter behaviour when the loader throws)
- Wait timeout and the fallback to the DB
- Lock expiry during a slow load
- Redis being down
- The stale-write race

## Verdict

Keep this commit as the stampede fix. Before calling it done, fix the leader-failure path so waiters fail fast or retry the lock once it's freed, instead of waiting out the full timeout, and add a test for it. The stale-write race is separate Stage 7 / 4.1 work.
