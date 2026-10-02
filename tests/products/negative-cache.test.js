const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('negative caching', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
  });

  test('missing product should not hit database on every request', async () => {
    const missingId = 99999;
    const first = await fetch(`${baseUrl}/products/${missingId}`);
    expect(first.status).toBe(404);
    const c1 = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();

    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
    const second = await fetch(`${baseUrl}/products/${missingId}`);
    expect(second.status).toBe(404);
    const c2 = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();

    const redis = await getRedis();
    const neg = await redis.exists(keys.negativeProduct(missingId));

    expect(c1.count).toBeGreaterThanOrEqual(1);
    expect(c2.count).toBe(0);
    expect(neg).toBe(1);
  });
});
