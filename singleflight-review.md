# singleFlight review (4 Oct 2026, uncommitted local changes)

Scope: `src/services/singleFlight.js`, `getWithSingleFlight` and `getProductById`. Review only: no source files were changed.

## What already works
- [x] Stampede tests pass, including the two flipped from `test.failing` to `test`, and the evaluate stampede check passes.
- [x] The leader is chosen by Redis `SET NX` with a random token and a 30 s expiry.
- [x] Requests that don't get the lock poll Redis (product key and not-found key) with backoff and jitter.
- [x] The lock is released in a `finally` via the token-checked Lua script.
- [x] Evaluate: **20/22**. Still failing: the hit-ratio check (a regression) and the stale-write race.

## 1. Correctness
- [ ] **1.1 Misses are counted twice.** The leader's double-check reads the cache again, so each miss is recorded twice. That pushed the hit-ratio check below 0.5 (3 hits, 4 misses, ratio 0.43). Which call in the leader path counts the second miss?
- [ ] **1.2 Jitter disappears at the cap.** Once the delay reaches 500 ms, `Math.min(..., maxDelayMs)` clips the jitter away, so all waiters poll in lockstep.
- [ ] **1.3 Waiters can't tell when the leader fails.** If the loader throws or the leader crashes, waiters keep polling. The 25 s wait is shorter than the 30 s lock, so they all time out together and hit the DB at once, which is a stampede anyway. Could waiters notice the lock is gone and try to take it?
- [ ] **1.4 The timeout fallback writes the cache without the lock.** This is close to the Stage 7 stale-write race.

## 2. Too much done for you
- [ ] **2.1 Every TODO is implemented:** the DB call, not-found caching, what happens on timeout, and error handling. These were meant to be your exercises.
- [ ] **2.2 The inner `try/catch` only logs and rethrows.** The `finally` already handles cleanup.
- [ ] **2.3 `if (!token) return;` in `releaseLock`** guards a case that can't happen, because it's only called with a token.
- [ ] **2.4 The `remaining <= 0` check** repeats the loop's deadline condition.
- [ ] **2.5 Four helpers are exported** (`acquireLock`, `releaseLock`, `waitForCache`, `LOCK_TTL_MS`), but only `getWithSingleFlight` is used.

## 3. Organisation and design
- [ ] **3.1 Mixed responsibilities.** The file is named like a generic utility but knows `lock:product:`, the product cache functions and `productRepository`. It mixes a reusable lock with product policy, and it drifts from our decision that the wrapper takes a `loader` and never imports the repository.
- [ ] **3.2 Read-through logic lives in two places.** `getProductById` is now a one-line pass-through, while list caching stays in `productService`.
- [ ] **3.3 Duplication.** Hit and not-found handling is written out three times: the first read, the double-check and the waiter.
- [ ] **3.4 Two result vocabularies:** `hit / negative / miss` and `ready / timedOut`.
- [ ] **3.5 Inconsistent logger argument order:** message-first for debug, object-first for error.

## Suggested direction
Build a small generic module, `singleFlight(key, loader)`, that owns only the lock, the wait loop and safe release. Keep the product policy (cache keys, not-found caching, what to do on timeout) in `productService`, which passes in a loader that calls `findById`.
