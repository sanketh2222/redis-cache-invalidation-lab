const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');

describe('cache stampede', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test('parallel misses for same product should coalesce database reads', async () => {
    await cacheService.flushAllProductCacheKeys();
    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });

    await Promise.all(
      Array.from({ length: 40 }, () => fetch(`${baseUrl}/products/3`))
    );

    const { count } = await (
      await fetch(`${baseUrl}/debug/db-query-count`)
    ).json();

    expect(count).toBeLessThanOrEqual(3);
  });
});
