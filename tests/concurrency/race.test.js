const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const productRepository = require('../../src/repositories/productRepository');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { hooks, resetHooks } = require('../../src/testing/cacheHooks');

describe('stale cache write race', () => {
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

  test.skip('legacy direct repo+setCachedProduct race (see race-http-put.test.js)', async () => {
    const productId = 1;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    hooks.afterDbRead = async (ctx) => {
      if (ctx.op === 'findById' && ctx.id === productId) {
        await gate;
      }
    };

    const slowGet = fetch(`${baseUrl}/products/${productId}`);
    await new Promise((r) => setTimeout(r, 30));

    const updated = await productRepository.update(productId, {
      name: `race-${Date.now()}`,
    });
    await cacheService.setCachedProduct(updated);
    release();
    await slowGet;

    const redis = await getRedis();
    const raw = await redis.get(keys.product(productId));
    const cached = JSON.parse(raw);
    expect(cached.version).toBeGreaterThanOrEqual(updated.version);
    expect(cached.name).toBe(updated.name);
  });
});
