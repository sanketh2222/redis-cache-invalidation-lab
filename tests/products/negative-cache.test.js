const config = require('../../src/config');
const { startTestServer, stopTestServer } = require('../helpers/testApp');
const { nextProductId } = require('../helpers/db');
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

  test('POST after 404 on next SERIAL id clears negative cache and GET returns 200', async () => {
    const nextId = await nextProductId();
    const miss = await fetch(`${baseUrl}/products/${nextId}`);
    expect(miss.status).toBe(404);

    const redis = await getRedis();
    expect(await redis.exists(keys.negativeProduct(nextId))).toBe(1);

    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Serial negative clear ${Date.now()}`,
        description: 'test',
        price: 9.99,
        category: 'electronics',
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    expect(created.id).toBe(nextId);

    expect(await redis.exists(keys.negativeProduct(nextId))).toBe(0);

    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
    const getRes = await fetch(`${baseUrl}/products/${nextId}`);
    expect(getRes.status).toBe(200);
    const { count } = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();
    expect(count).toBe(0);
  });

  test('after POST, evicting detail key still returns 200 without stale negative 404', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Detail eviction ${Date.now()}`,
        description: 'test',
        price: 11,
        category: 'home',
      }),
    });
    const created = await postRes.json();
    const redis = await getRedis();
    await redis.del(keys.product(created.id));

    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
    const getRes = await fetch(`${baseUrl}/products/${created.id}`);
    expect(getRes.status).toBe(200);
    const { count } = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await redis.exists(keys.negativeProduct(created.id))).toBe(0);
  });

  test('negative cache key has TTL within configured bounds', async () => {
    const missingId = 88888;
    await fetch(`${baseUrl}/products/${missingId}`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.negativeProduct(missingId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.negativeCacheTtlSeconds);
  });

  test('documents current behavior: PUT flushes all product:missing keys via product:* SCAN', async () => {
    const redis = await getRedis();
    const orphanId = 99999;
    await redis.set(keys.negativeProduct(orphanId), '1', {
      EX: config.negativeCacheTtlSeconds,
    });
    expect(await redis.exists(keys.negativeProduct(orphanId))).toBe(1);

    const detail = await (await fetch(`${baseUrl}/products/1`)).json();
    await fetch(`${baseUrl}/products/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: detail.price + 1 }),
    });

    expect(await redis.exists(keys.negativeProduct(orphanId))).toBe(0);
  });

  test('DELETE then GET seeds product:missing with TTL', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Delete negative ${Date.now()}`,
        description: 'temp',
        price: 1,
        category: 'temp-del',
      }),
    });
    const product = await postRes.json();
    await cacheService.flushAllProductCacheKeys();

    const del = await fetch(`${baseUrl}/products/${product.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const get = await fetch(`${baseUrl}/products/${product.id}`);
    expect(get.status).toBe(404);

    const redis = await getRedis();
    expect(await redis.exists(keys.negativeProduct(product.id))).toBe(1);
    const ttl = await redis.ttl(keys.negativeProduct(product.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.negativeCacheTtlSeconds);
  });
});
