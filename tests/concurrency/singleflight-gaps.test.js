/**
 * Failing tests for the gaps listed in review-5e6ade2.md.
 * Every test here is a plain `test` and is EXPECTED TO FAIL against the current
 * single-flight code. Each one turns green once the matching fix is implemented.
 * No production code was changed to write these.
 */
const cacheService = require('../../src/services/cacheService');
const productService = require('../../src/services/productService');
const productRepository = require('../../src/repositories/productRepository');
const { acquireLock } = require('../../src/services/singleFlight');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = Symbol('timeout');
const withDeadline = (p, ms) => Promise.race([p.catch((e) => e), sleep(ms).then(() => TIMEOUT)]);

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

  // Desired: a leader whose lock TTL expired mid-load must be fenced / its lock extended,
  // so a second request does NOT become a new leader and hit the DB.
  test('gap 2 - lock expiry: second request must not start a new DB load after TTL lapses', async () => {
    const id = 3;
    // Simulate a slow leader that took the lock with a short TTL and is still loading.
    const token = await acquireLock(id, 150);
    expect(token).toBeTruthy();
    await sleep(250); // lock expired, original leader still "working"

    const spy = jest.spyOn(productRepository, 'findById');
    await withDeadline(productService.getProductById(id), 3000);
    expect(spy).toHaveBeenCalledTimes(0);
  }, 10000);

  // Desired: when Redis is unavailable, getProductById fails open and reads from the DB.
  test('gap 3 - Redis down: getProductById falls back to DB instead of throwing', async () => {
    const id = 1;
    const down = () => Promise.reject(new Error('ECONNREFUSED redis'));
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
  test('gap 5 - in-memory dedupe: N concurrent misses make one SET NX lock call', async () => {
    const id = 5;
    const redis = await getRedis();
    const setSpy = jest.spyOn(redis, 'set');

    await Promise.all(Array.from({ length: 10 }, () => productService.getProductById(id)));

    const nxCalls = setSpy.mock.calls.filter(
      ([key, , opts]) => String(key).startsWith('lock:product:') && opts && opts.NX
    ).length;
    expect(nxCalls).toBe(1);
  }, 10000);

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
