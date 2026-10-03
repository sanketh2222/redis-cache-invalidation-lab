const { startTestServer, stopTestServer } = require('../helpers/testApp');
const { nextProductId } = require('../helpers/db');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

describe('negative cache create race', () => {
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
  });

  test.failing(
    'concurrent GET miss and POST same id must not leave negative cache poisoned',
    async () => {
      const nextId = await nextProductId();
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });

      hooks.afterDbRead = async (ctx) => {
        if (ctx.op === 'findById' && ctx.id === nextId && !ctx.row) {
          await gate;
        }
      };

      const slowGet = fetch(`${baseUrl}/products/${nextId}`);

      await new Promise((r) => setTimeout(r, 40));

      const postRes = await fetch(`${baseUrl}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Race create ${Date.now()}`,
          description: 'race',
          price: 3,
          category: 'electronics',
        }),
      });
      expect(postRes.status).toBe(201);
      const created = await postRes.json();
      expect(created.id).toBe(nextId);

      release();
      await slowGet;

      const redis = await getRedis();
      expect(await redis.exists(keys.negativeProduct(nextId))).toBe(0);

      const getRes = await fetch(`${baseUrl}/products/${nextId}`);
      expect(getRes.status).toBe(200);
    }
  );
});
