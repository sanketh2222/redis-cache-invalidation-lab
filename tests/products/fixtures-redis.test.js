const { resetFixtures } = require('../../scripts/reset-fixtures');
const { startTestServer, stopTestServer } = require('../helpers/testApp');
const { nextProductId } = require('../helpers/db');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('DB reset without Redis flush', () => {
  let baseUrl;

  beforeAll(async () => {
    ({ baseUrl } = await startTestServer());
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test('DELETE clears warmed detail cache so GET does not serve stale product', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Delete invalidation ${Date.now()}`,
        description: 'cache warm then delete',
        price: 12,
        category: 'electronics',
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();

    const warmGet = await fetch(`${baseUrl}/products/${created.id}`);
    expect(warmGet.status).toBe(200);

    const redis = await getRedis();
    expect(await redis.exists(keys.product(created.id))).toBe(1);

    const delRes = await fetch(`${baseUrl}/products/${created.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    expect(await redis.exists(keys.product(created.id))).toBe(0);

    const afterGet = await fetch(`${baseUrl}/products/${created.id}`);
    expect(afterGet.status).toBe(404);
  });
});
