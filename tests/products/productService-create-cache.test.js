const productService = require('../../src/services/productService');
const cacheService = require('../../src/services/cacheService');
const keys = require('../../src/redis/keys');
const { getRedis } = require('../../src/redis/client');
const { nextProductId } = require('../helpers/db');

describe('productService.createProduct', () => {
  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('removes negative cache when setCachedProduct throws after other cache steps', async () => {
    const nextId = await nextProductId();
    await cacheService.setNegativeCache(nextId);

    const redis = await getRedis();
    expect(await redis.exists(keys.negativeProduct(nextId))).toBe(1);

    const deleteNegativeSpy = jest.spyOn(cacheService, 'deleteNegativeCache');
    const invalidateListsSpy = jest.spyOn(cacheService, 'invalidateProductLists');
    const invalidateCategorySpy = jest.spyOn(cacheService, 'invalidateCategoryList');
    jest
      .spyOn(cacheService, 'setCachedProduct')
      .mockRejectedValueOnce(new Error('simulated setCachedProduct failure'));

    const category = 'electronics';
    const created = await productService.createProduct({
      name: `Negative cleanup on cache fail ${Date.now()}`,
      description: 'unit test',
      price: 11,
      category,
    });

    expect(created.id).toBe(nextId);
    expect(deleteNegativeSpy).toHaveBeenCalledWith(nextId);
    expect(invalidateListsSpy).toHaveBeenCalled();
    expect(invalidateCategorySpy).toHaveBeenCalledWith(category);
    expect(await redis.exists(keys.negativeProduct(nextId))).toBe(0);
  });
});
