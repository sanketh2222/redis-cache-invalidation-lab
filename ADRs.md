# 4.1 Dual-write race diagnosis

## 1. Race sequence

- DB write commits, cache still stale, GET reads old value.
- TODO (you): write the exact interleaving step by step (request A / request B, T1, T2, ...).

## 2. Fix options discussed

- Fail closed on cache write failure.
- Treat the operation as complete only after both the DB write and the cache write succeed.
- TODO (you): trade-offs of each.





##  Phase 4.1

### What the dual write problem is

1. Dual write: one logical update ("product 5 now costs 200") has to land in two
   stores, Postgres and Redis, as two separate operations, one after the other.

2. There is no atomicity across the two. No transaction covers both Postgres and
   Redis, so one write can succeed while the other fails, or lands late, or lands
   out of order relative to another request's writes.

3. Failure modes:
   - Cache first, then DB: readers see a value in Redis that may never commit
     (the DB write fails or rolls back). That's a phantom value.
   - DB first, then cache: between the two writes, readers keep getting the old
     cached value. That's the stale window. Normally it's short, but if the cache
     write fails it lasts until the TTL expires.
   - Crash or error between the two writes: the second write never happens, and
     the stores stay out of sync until the TTL expires or something else rewrites the key.
   - Ordering: two requests each do their two writes, and the cache writes land
     in a different order from the DB commits. The cache ends up holding the
     older value with nothing to correct it.

4. Why this lab's write flow has it: an update writes Postgres, then touches Redis
   (delete in the lab, SET in SkillMeet's PATCH). Separately, a GET on a cache miss
   reads Postgres and then SETs Redis. That's a second writer to the same key, using
   a row it read earlier. If that read happened before the update committed but
   its SET lands after the update's cache step, stale data gets written back into Redis.
   Nothing compares versions, so the stale value stays until the TTL runs out.
   Stage 7 (docs/stage7-dual-write-simulation.md) simulates exactly this with test hooks.




## Architectural decision 25 Oct 2026: drop gap 5 test (in-process dedupe), a deliberate trade-off
- Decision: removing the gap 5 test in `tests/concurrency/singleflight-gaps.test.js` (around line 196, "N concurrent misses should make one SET NX call") as an architectural trade-off, not just a cleanup.
- Reasoning: the Redis distributed lock (SET NX on `lock:product:<id>`) already guarantees single-flight correctness for a given key: only one request loads from the DB and fills the cache. A per-id in-memory Promise Map is an optional micro-optimization that adds complexity without preventing any real failure mode, even at 50-60 parallel requests.
- The test proved an optimization, not correctness, so it doesn't earn its keep.
- Known cost I'm accepting: losers on the same instance each still make their own SET NX attempt and poll Redis themselves (extra Redis round trips, no extra DB reads).