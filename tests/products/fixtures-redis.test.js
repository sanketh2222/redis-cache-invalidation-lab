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

  test('after resetFixtures, new row at reused id is not shadowed by stale Redis keys', async () => {
    const redis = await getRedis();
    await resetFixtures();
    const ghostId = await nextProductId();

    await redis.set(
      keys.product(ghostId),
      JSON.stringify({
        id: ghostId,
        name: 'Ghost Product',
        price: 0.01,
        category: 'ghost',
        version: 99,
      }),
      { EX: 60 }
    );
    await redis.set(keys.negativeProduct(ghostId), '1', { EX: 30 });

    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Reused id ${Date.now()}`,
        description: 'after truncate',
        price: 20,
        category: 'electronics',
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    expect(created.id).toBe(ghostId);

    const getRes = await fetch(`${baseUrl}/products/${ghostId}`);
    expect(getRes.status).toBe(200);
    const live = await getRes.json();
    expect(live.name).toBe(created.name);
    expect(live.name).not.toBe('Ghost Product');

    await cacheService.flushAllProductCacheKeys();
  });
});
