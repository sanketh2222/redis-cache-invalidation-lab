const config = require('../../src/config');
const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('TTL', () => {
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

  test('product detail keys expire with TTL within configured bound', async () => {
    await fetch(`${baseUrl}/products/1`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.product(1));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.productCacheTtlSeconds);
  });

  test('list cache has TTL within configured bound', async () => {
    await fetch(`${baseUrl}/products`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.productsList());
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.productCacheTtlSeconds);
  });

  test('category list cache has TTL within configured bound', async () => {
    await fetch(`${baseUrl}/products?category=electronics`);
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.productsCategory('electronics'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.productCacheTtlSeconds);
  });

  test('POST detail key has expiry (not persistent)', async () => {
    const res = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `TTL POST ${Date.now()}`,
        description: 'ttl',
        price: 3,
        category: 'home',
      }),
    });
    const created = await res.json();
    const redis = await getRedis();
    const ttl = await redis.ttl(keys.product(created.id));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.productCacheTtlSeconds);
    expect(ttl).not.toBe(-1);
  });
});
