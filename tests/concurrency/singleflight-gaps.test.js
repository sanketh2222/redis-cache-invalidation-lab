/**
 * Failing tests for the gaps listed in review-5e6ade2.md.
 * Every test here is a plain `test` and is EXPECTED TO FAIL against the current
 * single-flight code. Each one turns green once the matching fix is implemented.
 * No production code was changed to write these.
 */
const cacheService = require('../../src/services/cacheService');
const CacheUnavailableError = require('../../src/errors/CacheUnavailableError');
const productService = require('../../src/services/productService');
const productRepository = require('../../src/repositories/productRepository');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = Symbol('timeout');
const withDeadline = (p, ms) => Promise.race([p.catch((e) => e), sleep(ms).then(() => TIMEOUT)]);

/** Same convention as singleFlight.lockKey (not exported). */
function productLockKey(id) {
  return `lock:product:${id}`;
}

/**
 * Pause the first findById for id inside afterDbRead.
 * onEntered runs once, before the pause, so TTL changes stay visible at the call site.
 */
function gateFirstFindById(id, onEntered) {
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  let gated = false;

  hooks.afterDbRead = async (ctx) => {
    if (ctx.op !== 'findById' || Number(ctx.id) !== Number(id) || gated) return;
    gated = true;
    if (onEntered) await onEntered();
    markEntered();
    await gate;
  };

  return {
    entered,
    release: () => releaseGate(),
  };
}

async function expireProductLockSoon(id, ttlMs) {
  const redis = await getRedis();
  await redis.pExpire(productLockKey(id), ttlMs);
}

async function waitUntilProductLockAbsent(id, timeoutMs) {
  const redis = await getRedis();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await redis.exists(productLockKey(id))) === 0) return;
    await sleep(20);
  }
  throw new Error(`lock ${productLockKey(id)} did not expire within ${timeoutMs}ms`);
}

describe('single-flight gaps (review-5e6ade2.md)', () => {
  beforeEach(async () => {
    resetHooks();
    jest.restoreAllMocks();
    await cacheService.flushAllProductCacheKeys();
    const redis = await getRedis();
    for (const id of [1, 2, 3, 4, 5]) await redis.del(`lock:product:${id}`);
  });

  afterEach(() => {
    resetHooks();
    jest.restoreAllMocks();
  });

  // Desired: when the leader's DB load throws, waiters learn about it quickly
  // (fail fast, or take over / go to DB as soon as the lock frees), well under 2 s,
  // instead of polling ~25 s and then herding to the DB.
  test('gap 1 - leader failure: waiters settle within 2s instead of polling ~25s', async () => {
    const id = 2;
    const real = productRepository.findById;
    let calls = 0;
    jest.spyOn(productRepository, 'findById').mockImplementation(async (x) => {
      calls += 1;
      if (calls === 1) {
        await sleep(100);
        throw new Error('leader load failed');
      }
      return real(x);
    });

    const leader = productService.getProductById(id);
    await sleep(20);
    const waiters = Array.from({ length: 5 }, () => productService.getProductById(id));

    await expect(leader).rejects.toThrow('leader load failed');
    const started = Date.now();
    const results = await Promise.all(waiters.map((w) => withDeadline(w, 2000)));
    const settledInTime = results.filter((r) => r !== TIMEOUT).length;
    expect({ settledInTime, elapsedMs: Date.now() - started < 2100 }).toEqual({
      settledInTime: 5,
      elapsedMs: true,
    });
  }, 10000);

  // Desired: lock TTL expires while the leader is still loading. Exactly one waiter
  // takes over and reads the DB (leader read + one takeover = 2 findById calls).
  test('gap 2 - lock expiry: after TTL expires while leader loads, exactly one waiter takes over and reads the DB', async () => {
    const id = 3;
    const waiterCount = 8;
    const lockTtlMs = 150;

    // Phase: leader gated. First findById pauses; TTL is shortened only via expireProductLockSoon.
    const leaderGate = gateFirstFindById(id, () => expireProductLockSoon(id, lockTtlMs));
    const findByIdSpy = jest.spyOn(productRepository, 'findById');

    try {
      const leader = productService.getProductById(id);
      await leaderGate.entered; // leader is paused here after the first findById call db read

      // Phase: TTL lapses. Poll until the lock key is gone (leader still inside the gate).
      await waitUntilProductLockAbsent(id, lockTtlMs + 1000);

      // Phase: waiters fire while the leader has not written the cache yet.
      const waiters = Array.from({ length: waiterCount }, () => productService.getProductById(id));
      // No signal that waiters have observed the missing lock. Releasing immediately lets them
      // read the cache the leader is about to fill, so the single takeover read never happens.
      await sleep(50);

      // Phase: release leader, then assert leader + one takeover (2 findById) and every caller gets the row.
      leaderGate.release();
      const results = await Promise.all([leader, ...waiters]);

      for (const row of results) {
        expect(row).toEqual(expect.objectContaining({ id }));
      }
      expect(findByIdSpy).toHaveBeenCalledTimes(2);
    } finally {
      leaderGate.release();
    }
  }, 15000);

  // Desired: when Redis is unavailable, getProductById fails open and reads from the DB.
  test('gap 3 - Redis down: getProductById falls back to DB instead of throwing', async () => {
    const id = 1;
    const down = () => Promise.reject(new CacheUnavailableError('ECONNREFUSED redis'));
    jest.spyOn(cacheService, 'getCachedProduct').mockImplementation(down);
    jest.spyOn(cacheService, 'getNegativeCache').mockImplementation(down);
    jest.spyOn(cacheService, 'setCachedProduct').mockImplementation(down);
    jest.spyOn(cacheService, 'setNegativeCache').mockImplementation(down);

    const result = await productService.getProductById(id).catch((e) => e);
    expect(result).not.toBeInstanceOf(Error);
    expect(result).toEqual(expect.objectContaining({ id }));
  }, 10000);

  // Desired: after a PUT commits, a slow GET leader must not write the old row back.
  // Redis should hold the NEW row (or nothing), never the stale version.
  test('gap 4 - stale-write race: leader must not repopulate old row after PUT', async () => {
    const id = 4;
    let release;
    const gate = new Promise((r) => { release = r; });
    let gated = false;
    hooks.afterDbRead = async (ctx) => {
      if (ctx.op === 'findById' && ctx.id === id && !gated) {
        gated = true; // gate only the GET leader's read, not updateProduct's
        await gate;
      }
    };

    try {
      const slowGet = productService.getProductById(id);
      await sleep(50);
      const updated = await productService.updateProduct(id, { name: `gap4-${Date.now()}` });
      release();
      await slowGet;

      const redis = await getRedis();
      const raw = await redis.get(keys.product(id));
      const cached = raw ? JSON.parse(raw) : { version: updated.version, name: updated.name };
      expect(cached.version).toBeGreaterThanOrEqual(updated.version);
      expect(cached.name).toBe(updated.name);
    } finally {
      release();
    }
  }, 10000);

  // Desired: concurrent misses in one process share one in-flight promise,
  // so only ONE SET NX lock attempt goes to Redis.

  // reason for removal has been mentioned in adr-0001.md (notes.md)
  // test('gap 5 - in-memory dedupe: N concurrent misses make one SET NX lock call', async () => {
  //   const id = 5;
  //   const redis = await getRedis();
  //   const setSpy = jest.spyOn(redis, 'set');

  //   await Promise.all(Array.from({ length: 10 }, () => productService.getProductById(id)));

  //   const nxCalls = setSpy.mock.calls.filter(
  //     ([key, , opts]) => String(key).startsWith('lock:product:') && opts && opts.NX
  //   ).length;
  //   expect(nxCalls).toBe(1);
  // }, 10000);

  // Desired: list and category routes have stampede protection too,
  // so concurrent cold-cache calls hit the DB once each.
  test('gap 6 - list and category routes: concurrent cold misses hit DB once each', async () => {
    const product = await productRepository.findById(1);
    const allSpy = jest.spyOn(productRepository, 'findAll');
    const catSpy = jest.spyOn(productRepository, 'findByCategory');

    await Promise.all([
      ...Array.from({ length: 10 }, () => productService.listProducts()),
      ...Array.from({ length: 10 }, () => productService.listProductsByCategory(product.category)),
    ]);

    expect({ findAll: allSpy.mock.calls.length, findByCategory: catSpy.mock.calls.length })
      .toEqual({ findAll: 1, findByCategory: 1 });
  }, 10000);
});
