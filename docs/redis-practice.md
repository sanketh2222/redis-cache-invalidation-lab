# Redis practice — manual exercises

Use the Docker Redis instance from this project (`localhost:6380`).

## Connect

```bash
docker compose up -d
redis-cli -p 6380
```

Or without local `redis-cli`:

```bash
docker compose exec redis redis-cli
```

## Exercises

1. **Ping** — `PING` should return `PONG`.
2. **SET a product** — `SET product:demo '{"id":999,"name":"Demo","version":1}'`
3. **GET the product** — `GET product:demo`
4. **Add TTL** — `EXPIRE product:demo 30`
5. **Check TTL** — `TTL product:demo` (counts down)
6. **Delete** — `DEL product:demo`
7. **EXISTS** — `EXISTS product:demo` → `0`
8. **INCR cache hits** — `INCR metrics:cache_hits`
9. **Inspect app keys after API calls** — start API, `GET /products/1`, then `SCAN 0 MATCH product:*`
10. **Corrupt cache** — `SET product:1 '{"id":1,"name":"CORRUPT","version":0}'`, then `GET /products/1` via HTTP and compare
11. **Trigger invalidation** — `PUT /products/1`, then `GET product:1` in redis-cli
12. **List keys** — after `GET /products`, inspect `products:list`
13. **Category keys** — `GET /products?category=electronics`, inspect `products:category:electronics`
14. **Negative cache** — after fixing Stage 5, `GET /products/99999` twice and inspect `product:missing:99999`
15. **Eviction settings** — `CONFIG GET maxmemory` and `CONFIG GET maxmemory-policy` (match your `.env` / compose)
16. **Metrics** — curl `GET /metrics` while hitting the API

## Useful commands cheat sheet

| Command | Purpose |
| --- | --- |
| `GET key` | Read string value |
| `SET key value EX 60` | Set with TTL |
| `DEL key` | Remove key |
| `EXISTS key` | Check presence |
| `TTL key` | Seconds until expiry (`-1` no TTL, `-2` missing) |
| `SCAN 0 MATCH products:* COUNT 100` | Iterate keys safely |
| `INCR metrics:cache_hits` | Counter pattern |

## Glossary

**TOCTOU (time-of-check, time-of-use)** — A race where you **check** some condition at one moment and **act** on it later, while another request can change reality in between.

In this lab, `updateProduct` and `deleteProduct` call `findById` (check that the row exists), then call `update` / `remove` (use). If another client **deletes** that row after the check but before the write, the update can return no row and the handler may respond with **500** instead of **404**. That gap is separate from Stage 7’s stale **cache** write race (`docs/stage7-dual-write-simulation.md`).

Tests: `tests/concurrency/update-toctou.test.js` (sequential DELETE then PUT, and a hook-gated PUT vs DELETE race).

## Debugging tips during assessment

- Compare **HTTP response** vs **Redis GET** for the same entity id.
- After writes, check whether **detail** and **list** keys still exist.
- Watch whether TTL is accidentally removed (`TTL` becomes `-1`).
- For concurrency bugs, count DB queries or use Redis MONITOR during parallel curls.
