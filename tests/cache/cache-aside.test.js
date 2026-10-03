const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { resetDbQueryCount } = require('../../src/testing/dbMetrics');

describe('cache-aside', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
    resetDbQueryCount();
    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
  });

  test('cache miss loads from database and sets redis key', async () => {
    const res = await fetch(`${baseUrl}/products/1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(1);

    const countRes = await fetch(`${baseUrl}/debug/db-query-count`);
    const { count } = await countRes.json();
    expect(count).toBeGreaterThanOrEqual(1);

    const redis = await getRedis();
    const raw = await redis.get(keys.product(1));
    expect(raw).not.toBeNull();
    const cached = JSON.parse(raw);
    expect(cached.id).toBe(body.id);
    expect(cached.name).toBe(body.name);
    expect(cached.version).toBe(body.version);
  });

  test('cache hit avoids database query', async () => {
    await fetch(`${baseUrl}/products/1`);
    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });

    const res = await fetch(`${baseUrl}/products/1`);
    expect(res.status).toBe(200);

    const countRes = await fetch(`${baseUrl}/debug/db-query-count`);
    const { count } = await countRes.json();
    expect(count).toBe(0);
  });
});
