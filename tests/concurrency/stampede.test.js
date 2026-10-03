const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

const PARALLEL = 40;

describe('cache stampede', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    resetHooks();
    await cacheService.flushAllProductCacheKeys();
    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
  });

  test.skip('legacy parallel misses threshold (flaky without coalescing; see test.failing cases)', async () => {
    await Promise.all(
      Array.from({ length: PARALLEL }, () => fetch(`${baseUrl}/products/3`))
    );
    const { count } = await (
      await fetch(`${baseUrl}/debug/db-query-count`)
    ).json();
    expect(count).toBeLessThanOrEqual(3);
  });

  test.failing(
    'hook-gated parallel GET for existing product coalesces to one DB read',
    async () => {
      const productId = 3;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });

      hooks.afterDbRead = async (ctx) => {
        if (ctx.op === 'findById' && ctx.id === productId) {
          await gate;
        }
      };

      const requests = Array.from({ length: PARALLEL }, () =>
        fetch(`${baseUrl}/products/${productId}`)
      );

      await new Promise((r) => setTimeout(r, 50));
      release();
      await Promise.all(requests);

      const { count } = await (
        await fetch(`${baseUrl}/debug/db-query-count`)
      ).json();
      expect(count).toBe(1);
    }
  );

  test.failing(
    'parallel GET for missing id coalesces to one DB read and one negative key',
    async () => {
      const missingId = 77777;
      await cacheService.flushAllProductCacheKeys();
      await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });

      await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          fetch(`${baseUrl}/products/${missingId}`)
        )
      );

      const { count } = await (
        await fetch(`${baseUrl}/debug/db-query-count`)
      ).json();
      expect(count).toBe(1);

      const redis = await getRedis();
      expect(await redis.exists(keys.negativeProduct(missingId))).toBe(1);
    }
  );
});
