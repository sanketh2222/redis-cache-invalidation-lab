const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

describe('HTTP PUT stale cache write race', () => {
  let baseUrl;
  let releaseGate;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  }, 60000);

  afterAll(async () => {
    if (releaseGate) releaseGate();
    resetHooks();
    await stopTestServer();
  }, 60000);

  beforeEach(async () => {
    resetHooks();
    releaseGate = null;
    await cacheService.flushAllProductCacheKeys();
  });

  test.failing(
    'slow GET must not repopulate stale product after HTTP PUT invalidates cache',
    async () => {
      const productId = 1;
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
        releaseGate = resolve;
      });

      hooks.afterDbRead = async (ctx) => {
        if (ctx.op === 'findById' && ctx.id === productId) {
          await gate;
        }
      };

      try {
        const slowGet = fetch(`${baseUrl}/products/${productId}`);
        await new Promise((r) => setTimeout(r, 50));

        const putRes = await fetch(`${baseUrl}/products/${productId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `put-race-${Date.now()}` }),
        });
        expect(putRes.status).toBe(200);
        const updated = await putRes.json();

        release();
        await slowGet;

        const redis = await getRedis();
        const raw = await redis.get(keys.product(productId));
        const cached = raw ? JSON.parse(raw) : null;
        expect(cached).not.toBeNull();
        expect(cached.version).toBeGreaterThanOrEqual(updated.version);
        expect(cached.name).toBe(updated.name);
      } finally {
        release();
        releaseGate = null;
      }
    },
    60000
  );
});
