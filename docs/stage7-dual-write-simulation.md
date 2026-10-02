# Stage 7 — Dual-write / stale cache simulation

## Important disclaimer

This exercise uses **deterministic test hooks** (`src/testing/cacheHooks.js`) to reproduce a **stale cache write** scenario locally. It is a **practice simulation** only:

- It is **not** a description of Skillmeet's private grader logic.
- The real assessment may detect consistency problems differently (load tests, multi-replica traffic, timing, etc.).

Use this stage to practice **diagnosis and reasoning**, not to memorize a single hook-based fix.

## Scenario (simulated)

Two logical "writers" interact with the same Redis key:

1. **Request A** — cache miss on `GET /products/:id`, reads an older row from PostgreSQL, then pauses before writing Redis.
2. **Request B** — updates PostgreSQL to a newer `version`, then writes the newer value to Redis.
3. **Request A** resumes and writes its **older** payload to Redis without checking `version`.

If step 3 succeeds blindly, Redis can serve stale data even though Postgres is correct.

## Where to look in this repo

| Piece | Location |
| --- | --- |
| Hook injection | `src/testing/cacheHooks.js` |
| Naive cache SET | `src/services/cacheService.js` → `setCachedProduct` |
| Evaluator check | `scripts/evaluate.js` → "Stale cache write protection (simulated dual-write)" |
| Jest test | `tests/concurrency/race.test.js` |

## What you are expected to figure out

Implement a consistency strategy (version check, delete-on-write, locking, etc.) **without** this document prescribing the final code.

After your fix, re-run:

```bash
npm test -- tests/concurrency/race.test.js
npm run evaluate
```
