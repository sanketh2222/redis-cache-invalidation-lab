const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('category list caching', () => {
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

  test('GET ?category= warms cache and second request avoids DB', async () => {
    const first = await fetch(`${baseUrl}/products?category=electronics`);
    expect(first.status).toBe(200);
    const body1 = await first.json();
    expect(body1.products.length).toBeGreaterThanOrEqual(2);

    await fetch(`${baseUrl}/debug/db-query-count/reset`, { method: 'POST' });
    const second = await fetch(`${baseUrl}/products?category=electronics`);
    expect(second.status).toBe(200);
    const { count } = await (await fetch(`${baseUrl}/debug/db-query-count`)).json();
    expect(count).toBe(0);

    const redis = await getRedis();
    expect(await redis.exists(keys.productsCategory('electronics'))).toBe(1);
  });

  test('POST to warmed category invalidates category list', async () => {
    await fetch(`${baseUrl}/products?category=electronics`);
    const before = await (await fetch(`${baseUrl}/products?category=electronics`)).json();
    const countBefore = before.products.length;

    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Category stale fix ${Date.now()}`,
        description: 'cat test',
        price: 19.99,
        category: 'electronics',
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();

    const after = await (await fetch(`${baseUrl}/products?category=electronics`)).json();
    expect(after.products.length).toBe(countBefore + 1);
    expect(after.products.some((p) => p.id === created.id)).toBe(true);
  });

  test('empty category cache updates after POST to that category', async () => {
    const category = `newcat-${Date.now()}`;
    const empty = await (await fetch(`${baseUrl}/products?category=${encodeURIComponent(category)}`)).json();
    expect(empty.products).toEqual([]);

    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `First in ${category}`,
        description: 'new',
        price: 5,
        category,
      }),
    });
    expect(postRes.status).toBe(201);
    const created = await postRes.json();

    const after = await (await fetch(`${baseUrl}/products?category=${encodeURIComponent(category)}`)).json();
    expect(after.products.length).toBe(1);
    expect(after.products[0].id).toBe(created.id);
  });

  test('PUT moving category updates both category lists', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Move cat ${Date.now()}`,
        description: 'move',
        price: 6,
        category: 'stationery',
      }),
    });
    const product = await postRes.json();

    await fetch(`${baseUrl}/products?category=stationery`);
    await fetch(`${baseUrl}/products?category=home`);

    await fetch(`${baseUrl}/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'home' }),
    });

    const stationery = await (await fetch(`${baseUrl}/products?category=stationery`)).json();
    const home = await (await fetch(`${baseUrl}/products?category=home`)).json();

    expect(stationery.products.some((p) => p.id === product.id)).toBe(false);
    expect(home.products.some((p) => p.id === product.id)).toBe(true);
  });

  test('DELETE removes product from list and category caches', async () => {
    const postRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Delete list ${Date.now()}`,
        description: 'del',
        price: 4,
        category: 'home',
      }),
    });
    const product = await postRes.json();

    await fetch(`${baseUrl}/products`);
    await fetch(`${baseUrl}/products?category=home`);

    const del = await fetch(`${baseUrl}/products/${product.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const list = await (await fetch(`${baseUrl}/products`)).json();
    const cat = await (await fetch(`${baseUrl}/products?category=home`)).json();
    expect(list.products.some((p) => p.id === product.id)).toBe(false);
    expect(cat.products.some((p) => p.id === product.id)).toBe(false);

    const redis = await getRedis();
    const listKey = await redis.exists(keys.productsList());
    const catKey = await redis.exists(keys.productsCategory('home'));
    expect(listKey).toBe(1);
    expect(catKey).toBe(1);
  });
});
