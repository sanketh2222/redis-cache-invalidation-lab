const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
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
