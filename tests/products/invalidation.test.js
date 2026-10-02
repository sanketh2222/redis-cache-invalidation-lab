const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('cache invalidation', () => {
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

  test('PUT keeps redis detail cache consistent with database', async () => {
    const warm = await fetch(`${baseUrl}/products/1`);
    const before = await warm.json();

    const putRes = await fetch(`${baseUrl}/products/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${before.name}-updated` }),
    });
    const updated = await putRes.json();

    const getRes = await fetch(`${baseUrl}/products/1`);
    const after = await getRes.json();
    const redis = await getRedis();
    const raw = await redis.get(keys.product(1));
    const cached = raw ? JSON.parse(raw) : null;

    expect(updated.name).toContain('-updated');
    expect(after.name).toBe(updated.name);
    expect(after.version).toBe(updated.version);
    expect(cached).not.toBeNull();
    expect(cached.name).toBe(updated.name);
    expect(cached.version).toBe(updated.version);
  });

  test('PUT invalidates dependent list cache', async () => {
    await fetch(`${baseUrl}/products`);
    const detail = await (await fetch(`${baseUrl}/products/1`)).json();

    const putRes = await fetch(`${baseUrl}/products/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: detail.price + 10 }),
    });
    const updated = await putRes.json();

    const list = await (await fetch(`${baseUrl}/products`)).json();
    const item = list.products.find((p) => p.id === 1);
    expect(item.price).toBe(updated.price);
  });

  test('DELETE removes stale detail cache', async () => {
    const created = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Temp Delete Me',
        description: 'temp',
        price: 1,
        category: 'temp',
      }),
    });
    const product = await created.json();

    await fetch(`${baseUrl}/products/${product.id}`);
    const del = await fetch(`${baseUrl}/products/${product.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const redis = await getRedis();
    const exists = await redis.exists(keys.product(product.id));
    expect(exists).toBe(0);

    const get = await fetch(`${baseUrl}/products/${product.id}`);
    expect(get.status).toBe(404);
  });
});
