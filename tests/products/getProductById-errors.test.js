const cacheService = require('../../src/services/cacheService');
const productService = require('../../src/services/productService');
const productRepository = require('../../src/repositories/productRepository');
const CacheUnavailableError = require('../../src/errors/CacheUnavailableError');
const { closeRedis } = require('../../src/redis/client');

describe('getProductById error handling', () => {
  afterAll(async () => {
    await closeRedis();
  });

  beforeEach(async () => {
    await cacheService.flushAllProductCacheKeys();
    jest.restoreAllMocks();
  });

  test('rethrows non-cache errors from single-flight', async () => {
    const dbErr = new Error('database unavailable');
    jest.spyOn(productRepository, 'findById').mockRejectedValue(dbErr);

    await expect(productService.getProductById(1)).rejects.toBe(dbErr);
  });

  test('returns DB row when cache write fails after successful load', async () => {
    const id = 1;
    const fromDb = await productRepository.findById(id);
    expect(fromDb).toEqual(expect.objectContaining({ id }));

    const findSpy = jest.spyOn(productRepository, 'findById');
    jest
      .spyOn(cacheService, 'setCachedProduct')
      .mockRejectedValue(new CacheUnavailableError('cache write failed'));

    const result = await productService.getProductById(id);
    expect(result).toEqual(expect.objectContaining({ id, name: fromDb.name }));
    expect(findSpy).toHaveBeenCalledTimes(1);
  });
});
