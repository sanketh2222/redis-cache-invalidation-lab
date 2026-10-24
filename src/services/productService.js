const productRepository = require('../repositories/productRepository');
const cacheService = require('./cacheService');
const {
  getWithSingleFlight,
  getListWithSingleFlight,
  getCategoryListWithSingleFlight,
} = require('./singleFlight');
const logger = require('../logging/logger');
const CacheUnavailableError = require('../errors/CacheUnavailableError');

async function getProductById(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    const err = new Error('Invalid product id');
    err.status = 400;
    throw err;
  }

  try {
    return await getWithSingleFlight(numericId);
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      logger.warn('Cache unavailable in getProductById; falling back to DB', {
        err: error,
        productId: numericId,
      });
      return productRepository.findById(numericId);
    }
    logger.error('getProductById failed', { err: error, productId: numericId });
    throw error;
  }
}

async function listProducts() {
  try {
    return await getListWithSingleFlight();
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      logger.warn('Cache unavailable in listProducts; falling back to DB', { err: error });
      return productRepository.findAll();
    }
    logger.error('listProducts failed', { err: error });
    throw error;
  }
}

async function listProductsByCategory(category) {
  try {
    return await getCategoryListWithSingleFlight(category);
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      logger.warn('Cache unavailable in listProductsByCategory; falling back to DB', {
        err: error,
        category,
      });
      return productRepository.findByCategory(category);
    }
    logger.error('listProductsByCategory failed', { err: error, category });
    throw error;
  }
}

async function createProduct(payload) {
  const created = await productRepository.create(payload);

  try {
    
    await cacheService.deleteNegativeCache(created.id);

    await cacheService.invalidateProductLists();
    await cacheService.invalidateCategoryList(created.category);
    
    await cacheService.setCachedProduct(created);

  } catch (error) {
    logger.warn('Cache invalidation failed after product creation', {
      err: error,
      productId: created.id,
      category: created.category,
    });
  }

  return created;
}

async function updateProduct(id, payload) {
  const existing = await productRepository.findById(Number(id));
  if (!existing) return null;

  const updated = await productRepository.update(Number(id), payload);
  await cacheService.invalidateProductCaches(updated.id, existing.category, updated.category);
  await cacheService.setCachedProduct(updated);
  return updated;
}

async function deleteProduct(id) {
  const existing = await productRepository.findById(Number(id));
  if (!existing) return false;

  const ok = await productRepository.remove(Number(id));
  if (ok) {
    await cacheService.invalidateProductCaches(existing.id, existing.category, null);
  }
  return ok;
}

module.exports = {
  getProductById,
  listProducts,
  listProductsByCategory,
  createProduct,
  updateProduct,
  deleteProduct,
};
