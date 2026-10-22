const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');

describe('setCachedProduct version guard', () => {
  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
  });

  test('rejects write when incoming version is older than cached', async () => {
    const redis = await getRedis();
    const newer = {
      id: 1,
      name: 'newer',
      description: '',
      price: 10,
      category: 'electronics',
      version: 5,
    };
    await cacheService.setCachedProduct(newer);

    const older = { ...newer, name: 'stale', version: 4 };
    await cacheService.setCachedProduct(older);

    const raw = await redis.get(keys.product(1));
    const cached = JSON.parse(raw);
    expect(cached.version).toBe(5);
    expect(cached.name).toBe('newer');
  });

  test('defaults missing version to 1 on write', async () => {
    const redis = await getRedis();
    const withoutVersion = {
      id: 2,
      name: 'no-version-field',
      description: '',
      price: 1,
      category: 'home',
    };
    await cacheService.setCachedProduct(withoutVersion);

    const raw = await redis.get(keys.product(2));
    const cached = JSON.parse(raw);
    expect(cached.version).toBe(1);
  });
});
