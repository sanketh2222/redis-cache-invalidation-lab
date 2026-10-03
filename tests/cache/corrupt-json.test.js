const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('corrupt cache payload', () => {
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

  test('corrupt product detail JSON falls through to database', async () => {
    const redis = await getRedis();
    await redis.set(keys.product(1), '{not-json', { EX: 60 });

    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
    const res = await fetch(`${baseUrl}/products/1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(1);

    const { count } = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
