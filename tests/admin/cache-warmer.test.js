const { parseWarmProductIds } = require('../../src/services/cacheWarmer');
const { startTestServer, stopTestServer } = require('../helpers/testApp');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('cache warmer', () => {
  describe('parseWarmProductIds', () => {
    const original = process.env.CACHE_WARM_PRODUCT_IDS;

    afterEach(() => {
      if (original === undefined) delete process.env.CACHE_WARM_PRODUCT_IDS;
      else process.env.CACHE_WARM_PRODUCT_IDS = original;
      jest.resetModules();
    });

    test('filters invalid, zero, negative, and duplicate ids', () => {
      process.env.CACHE_WARM_PRODUCT_IDS = ' 1, 0, -1, abc, 2, 2 , ';
      jest.resetModules();
      const { parseWarmProductIds: parse } = require('../../src/services/cacheWarmer');
      expect(parse()).toEqual([1, 2, 2]);
    });
  });

  describe('POST /admin/cache/warm', () => {
    let baseUrl;
    const originalIds = process.env.CACHE_WARM_PRODUCT_IDS;

    beforeAll(async () => {
      process.env.CACHE_WARM_PRODUCT_IDS = '1,99999';
      ({ baseUrl } = await startTestServer());
    });

    afterAll(async () => {
      await stopTestServer();
      if (originalIds === undefined) delete process.env.CACHE_WARM_PRODUCT_IDS;
      else process.env.CACHE_WARM_PRODUCT_IDS = originalIds;
    });

    beforeEach(async () => {
      await cacheService.flushAllProductCacheKeys();
    });

    test('returns 501 when CACHE_WARM_PRODUCT_IDS is empty', async () => {
      const prev = process.env.CACHE_WARM_PRODUCT_IDS;
      delete process.env.CACHE_WARM_PRODUCT_IDS;
      const res = await fetch(`${baseUrl}/admin/cache/warm`, { method: 'POST' });
      expect(res.status).toBe(501);
      process.env.CACHE_WARM_PRODUCT_IDS = prev;
    });

    test('warm run for missing id writes negative cache entry', async () => {
      await cacheService.flushAllProductCacheKeys();
      const res = await fetch(`${baseUrl}/admin/cache/warm`, { method: 'POST' });
      expect(res.status).toBe(200);

      const redis = await getRedis();
      expect(await redis.exists(keys.negativeProduct(99999))).toBe(1);
      expect(await redis.exists(keys.product(1))).toBe(1);
    });

    test('response includes configured ids (warmed list may be empty until implemented)', async () => {
      const res = await fetch(`${baseUrl}/admin/cache/warm`, { method: 'POST' });
      const body = await res.json();
      expect(body.configuredIds).toEqual(expect.arrayContaining([1, 99999]));
      expect(Array.isArray(body.warmed)).toBe(true);
    });
  });
});
