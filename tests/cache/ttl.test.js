const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('TTL', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
  });

  test('product detail keys expire with TTL', async () => {
    await fetch(`${baseUrl}/products/1`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.product(1));
    expect(ttl).toBeGreaterThan(0);
  });

  test('list cache should have TTL (currently missing in starter code)', async () => {
    await fetch(`${baseUrl}/products`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.productsList());
    expect(ttl).toBeGreaterThan(0);
  });
});
