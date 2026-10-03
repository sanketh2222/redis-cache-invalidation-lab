const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('invalidation redis keyspace', () => {
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

  test('POST clears list and category keys while setting detail', async () => {
    await fetch(`${baseUrl}/products`);
    await fetch(`${baseUrl}/products?category=electronics`);

    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Keyspace POST ${Date.now()}`,
        description: 'ks',
        price: 8,
        category: 'electronics',
      }),
    });
    const created = await postRes.json();

    const redis = await getRedis();
    expect(await redis.exists(keys.product(created.id))).toBe(1);
    expect(await redis.exists(keys.productsList())).toBe(0);
    expect(await redis.exists(keys.productsCategory('electronics'))).toBe(0);
  });

  test('PUT flush removes detail and list keys until repopulated', async () => {
    await fetch(`${baseUrl}/products/1`);
    await fetch(`${baseUrl}/products`);

    await fetch(`${baseUrl}/products/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 99 }),
    });

    const redis = await getRedis();
    expect(await redis.exists(keys.product(1))).toBe(0);
    expect(await redis.exists(keys.productsList())).toBe(0);

    await fetch(`${baseUrl}/products/1`);
    expect(await redis.exists(keys.product(1))).toBe(1);
  });
});
